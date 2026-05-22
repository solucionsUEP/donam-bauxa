<?php
/**
 * /api/chat — bridges browser → home-server Ollama via Cloudflare Tunnel.
 *
 * GET  /api/chat/health  → 200 { ok, model, models[] } (no auth, cheap probe)
 * POST /api/chat         → streams NDJSON. Requires a Supabase JWT.
 *
 * The actual generation happens on the home server. This file:
 *   1. Validates the Supabase JWT (any role; chat is open to all signed-in users).
 *   2. Applies a best-effort per-user rate limit (8 / 60s, file-backed).
 *   3. cURL POSTs to OLLAMA_TUNNEL_URL with `Authorization: Bearer
 *      OLLAMA_SHARED_SECRET` and streams chunks back via CURLOPT_WRITEFUNCTION.
 *   4. Bubbles up 429 from the proxy untouched so the frontend can show a
 *      "the assistant is busy" banner with the right delay.
 *
 * Required config.php constants:
 *   OLLAMA_TUNNEL_URL     e.g. https://ollama.donambauxa.online (no trailing slash)
 *   OLLAMA_SHARED_SECRET  matches /etc/donam-bauxa/proxy.env on the home server
 *   OLLAMA_MODEL          optional; defaults to gemma4:e2b
 */

// Allow long generations. Apache default of 30s is too low for slower prompts.
@set_time_limit(120);

if (!defined('OLLAMA_TUNNEL_URL') || !defined('OLLAMA_SHARED_SECRET')) {
    http_response_code(500);
    echo json_encode(['error' => 'chat_not_configured', 'detail' => 'OLLAMA_TUNNEL_URL or OLLAMA_SHARED_SECRET missing from api/config.php']);
    return;
}

$ollamaUrl    = rtrim(OLLAMA_TUNNEL_URL, '/');
$ollamaSecret = OLLAMA_SHARED_SECRET;
$ollamaModel  = defined('OLLAMA_MODEL') ? OLLAMA_MODEL : 'gemma4:e2b';

// ── Health probe ────────────────────────────────────────────────────────────
if ($uri === '/api/chat/health' && $method === 'GET') {
    $ch = curl_init($ollamaUrl . '/api/tags');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $ollamaSecret],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($code !== 200) {
        http_response_code(502);
        echo json_encode(['ok' => false, 'error' => $err ?: "tunnel HTTP $code"]);
        return;
    }
    $data = json_decode($body, true) ?: [];
    echo json_encode([
        'ok'     => true,
        'model'  => $ollamaModel,
        'models' => array_map(fn($m) => $m['name'] ?? '', $data['models'] ?? []),
    ]);
    return;
}

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    return;
}

// ── Auth ────────────────────────────────────────────────────────────────────
$user = requireAuth();
$userId = $user['id'];

// ── Rate limit: 8 per 60s, file-backed (best-effort) ────────────────────────
// File-backed so it survives across PHP process boundaries. The home-server
// proxy semaphore is the hard guard; this is just to prevent a single user
// from spamming the GPU.
const CHAT_RATE_WINDOW_S = 60;
const CHAT_RATE_MAX      = 8;
$rateFile = sys_get_temp_dir() . '/dnb_chat_rate_' . hash('sha256', $userId) . '.json';
$now = time();

$fp = fopen($rateFile, 'c+');
if ($fp && flock($fp, LOCK_EX)) {
    $contents  = stream_get_contents($fp);
    $stamps    = json_decode($contents ?: '[]', true) ?: [];
    // Drop entries older than the window.
    $stamps    = array_values(array_filter($stamps, fn($t) => $now - $t < CHAT_RATE_WINDOW_S));
    if (count($stamps) >= CHAT_RATE_MAX) {
        $retryAfter = CHAT_RATE_WINDOW_S - ($now - $stamps[0]);
        flock($fp, LOCK_UN);
        fclose($fp);
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        echo json_encode(['error' => 'rate_limited', 'retryAfter' => $retryAfter]);
        return;
    }
    $stamps[] = $now;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($stamps));
    flock($fp, LOCK_UN);
    fclose($fp);
}

// ── Validate request body ───────────────────────────────────────────────────
$messages = $body['messages'] ?? null;
if (!is_array($messages) || empty($messages)) {
    http_response_code(400);
    echo json_encode(['error' => 'messages[] required']);
    return;
}

// Canonical system prompt — kept identical to routes/chat.js so behavior matches
// between local dev (Node) and production (PHP).
$systemPrompt = "Ets l'assistent virtual de Dona'm Bauxa, una plataforma de descoberta musical i d'esdeveniments a Mallorca. Respons en catala per defecte (canvia a castella o angles si l'usuari ho fa). Mante un to amistos, breu i concret.\n\n"
    . "Tens tres especialitats:\n\n"
    . "1. PLANIFICADOR DE CAP DE SETMANA\n"
    . "   Si l'usuari demana un pla i menciona un dia concret (dissabte / diumenge / divendres vespre), respon amb un itinerari estructurat en franges horaries (mati, migdia, tarda, vespre, nit). Cada franja: 1 activitat + 1 frase de context. Si menciona Mallorca, dona suggeriments locals plausibles (cala, mercat, ruta, concert). Si no especifica dia, demana-li quin dia vol planificar.\n\n"
    . "2. RECOMANADOR MUSICAL\n"
    . "   Si l'usuari nomena un artista, canco o genere, suggereix 3-5 artistes o temes similars amb una frase curta explicant la connexio (estil, escena, epoca). Si nomes diu \"recomana'm musica\", pregunta quin estil li agrada.\n\n"
    . "3. AJUDANT GENERAL\n"
    . "   Per a qualsevol altra pregunta (saludar, dubtes sobre la plataforma, preguntes curioses), respon de manera educada i concisa (1-3 frases).\n\n"
    . "DADES DE LA PLATAFORMA: Quan rebis un bloc \"CONTEXT (dades reals…)\" abans del missatge de l'usuari, basa la teva resposta NOMES en aquestes dades. Cita els esdeveniments i artistes pel nom exacte i, si esmentes una data o lloc, fes-ho amb les dades del context. No inventis esdeveniments, dates ni recintes que no apareguin al context. Si el context esta buit o no inclou cap element rellevant, digues que no trobes res a l'agenda i suggereix que l'usuari ajusti la cerca.\n\n"
    . "Format: usa llistes Markdown quan ajudin a la lectura. Evita disclaimers innecessaris.";

$payload = [
    'model'    => $body['model'] ?? $ollamaModel,
    'stream'   => true,
    'messages' => array_merge(
        [['role' => 'system', 'content' => $systemPrompt]],
        $messages
    ),
    'options'  => ['temperature' => 0.7, 'num_ctx' => 8192],
];

// ── Stream from the tunnel back to the browser ─────────────────────────────
// Don't commit streaming headers yet — we don't know if the proxy will return
// a 200 (stream) or a 4xx/5xx (single JSON error with a proper status code).
// The first byte of a *successful* chunk decides; CURLOPT_HEADERFUNCTION sets
// $proxyStatus before any body bytes arrive.

$ch = curl_init($ollamaUrl . '/api/chat');
$proxyStatus     = null;
$proxyRetryAfter = null;
$started         = false;   // have we already started streaming to the client?
curl_setopt_array($ch, [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $ollamaSecret,
    ],
    CURLOPT_TIMEOUT      => 0, // no overall cap; PHP set_time_limit() handles wall-clock.
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$proxyStatus, &$proxyRetryAfter) {
        if (preg_match('#^HTTP/[\d.]+ (\d+)#', $header, $m)) {
            $proxyStatus = (int) $m[1];
        } elseif (stripos($header, 'Retry-After:') === 0) {
            $proxyRetryAfter = trim(substr($header, 12));
        }
        return strlen($header);
    },
    CURLOPT_WRITEFUNCTION => function ($curl, $data) use (&$proxyStatus, &$started) {
        // Proxy returned an error: discard its body so we can send a proper
        // status + JSON envelope after curl_exec() returns.
        if ($proxyStatus !== null && $proxyStatus >= 400) {
            return strlen($data);
        }
        // First successful byte: commit the NDJSON streaming headers, then
        // stop buffering so each chunk reaches the client immediately.
        if (!$started) {
            $started = true;
            header('Content-Type: application/x-ndjson; charset=utf-8');
            header('Cache-Control: no-cache');
            header('X-Accel-Buffering: no');
            while (ob_get_level() > 0) ob_end_flush();
            ob_implicit_flush(true);
        }
        echo $data;
        @flush();
        return strlen($data);
    },
]);

curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);

// Error handling: if we never started streaming, we can still send a real HTTP
// status. If we did, we can only append an NDJSON error line (the frontend's
// parser surfaces it as a "delta.error").
if ($proxyStatus === 429) {
    if (!$started) {
        http_response_code(429);
        if ($proxyRetryAfter !== null) header('Retry-After: ' . $proxyRetryAfter);
        echo json_encode(['error' => 'assistant_busy', 'retryAfter' => (int) ($proxyRetryAfter ?? 5)]);
    } else {
        echo json_encode(['error' => 'assistant_busy']) . "\n";
    }
} elseif ($proxyStatus !== null && $proxyStatus >= 400) {
    if (!$started) {
        http_response_code(502);
        echo json_encode(['error' => "ollama_upstream_$proxyStatus"]);
    } else {
        echo json_encode(['error' => "ollama_upstream_$proxyStatus"]) . "\n";
    }
} elseif ($err) {
    if (!$started) {
        http_response_code(502);
        echo json_encode(['error' => 'tunnel_unreachable', 'detail' => $err]);
    } else {
        echo json_encode(['error' => 'tunnel_unreachable']) . "\n";
    }
}
