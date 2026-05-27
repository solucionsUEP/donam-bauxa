<?php
/**
 * Web Push subscription management.
 *
 *   GET  /api/push/vapid         → { publicKey }   (public, unauthenticated)
 *   POST /api/push/subscribe     → upsert subscription for the signed-in user
 *   POST /api/push/unsubscribe   → delete by endpoint (signed-in user only)
 *
 * Subscriptions are stored in api/private/push-subscriptions.json. Each entry:
 *   {
 *     "id":         "psub-<n>",
 *     "userId":     "<supabase user uuid>",
 *     "endpoint":   "https://fcm.googleapis.com/...",
 *     "keys":       { "p256dh": "...", "auth": "..." },
 *     "userAgent":  "Mozilla/...",
 *     "createdAt":  "2026-05-23T14:00:00+00:00",
 *     "lastSeen":   "2026-05-23T14:00:00+00:00"
 *   }
 *
 * Uniqueness is on `endpoint` — the same browser re-subscribing with the same
 * endpoint replaces (upserts) instead of duplicating.
 */

$PUSH_FILE = PRIVATE_DIR . '/push-subscriptions.json';

// GET /api/push/vapid — anyone can read the public key (it's literally public).
if ($uri === '/api/push/vapid' && $method === 'GET') {
    echo json_encode(['publicKey' => VAPID_PUBLIC_KEY]);
    return;
}

if ($uri === '/api/push/subscribe' && $method === 'POST') {
    $user = requireAuth();

    $sub = $body['subscription'] ?? null;
    if (!is_array($sub)
        || empty($sub['endpoint'])
        || empty($sub['keys']['p256dh'])
        || empty($sub['keys']['auth'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Subscripció no vàlida']);
        return;
    }

    $endpoint  = (string) $sub['endpoint'];
    $p256dh    = (string) $sub['keys']['p256dh'];
    $auth      = (string) $sub['keys']['auth'];
    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $now       = date('c');

    $result = writeJSONSafe($PUSH_FILE, function (&$data) use (
        $user, $endpoint, $p256dh, $auth, $userAgent, $now
    ) {
        $items = $data['itemListElement'] ?? [];

        // Look for an existing entry with the same endpoint — replace it so a
        // user re-subscribing on the same browser doesn't accumulate dupes.
        $existingIdx = null;
        foreach ($items as $i => $entry) {
            if (isset($entry['endpoint']) && $entry['endpoint'] === $endpoint) {
                $existingIdx = $i;
                break;
            }
        }

        if ($existingIdx !== null) {
            $items[$existingIdx]['userId']    = $user['id'];
            $items[$existingIdx]['keys']      = ['p256dh' => $p256dh, 'auth' => $auth];
            $items[$existingIdx]['userAgent'] = $userAgent;
            $items[$existingIdx]['lastSeen']  = $now;
        } else {
            $idInfo = generateId('psub', $items);
            $items[] = [
                'id'        => $idInfo['id'],
                'position'  => $idInfo['position'],
                'userId'    => $user['id'],
                'endpoint'  => $endpoint,
                'keys'      => ['p256dh' => $p256dh, 'auth' => $auth],
                'userAgent' => $userAgent,
                'createdAt' => $now,
                'lastSeen'  => $now,
            ];
        }

        $data['itemListElement'] = $items;
        $data['numberOfItems']   = count($items);
        return true;
    });

    if (!$result) {
        http_response_code(500);
        echo json_encode(['error' => 'No s\'ha pogut guardar la subscripció']);
        return;
    }

    echo json_encode(['ok' => true]);
    return;
}

if ($uri === '/api/push/unsubscribe' && $method === 'POST') {
    $user = requireAuth();

    $endpoint = $body['endpoint'] ?? null;
    if (!$endpoint) {
        http_response_code(400);
        echo json_encode(['error' => 'Endpoint obligatori']);
        return;
    }

    $removed = writeJSONSafe($PUSH_FILE, function (&$data) use ($user, $endpoint) {
        $items = $data['itemListElement'] ?? [];
        $kept  = [];
        $count = 0;
        foreach ($items as $entry) {
            // Match by endpoint AND user, so one user can't unsubscribe another.
            if (($entry['endpoint'] ?? null) === $endpoint
                && ($entry['userId'] ?? null) === $user['id']) {
                $count++;
                continue;
            }
            $kept[] = $entry;
        }
        $data['itemListElement'] = $kept;
        $data['numberOfItems']   = count($kept);
        return $count;
    });

    echo json_encode(['ok' => true, 'removed' => (int) $removed]);
    return;
}

http_response_code(404);
echo json_encode(['error' => 'Ruta no trobada']);
