<?php
/**
 * Push notification helper.
 *
 *   pushBroadcast($payload)             — send to every recorded subscription
 *   pushToUsers($userIds, $payload)     — send only to subscriptions owned by
 *                                         the given user ids
 *
 * `$payload` shape (forwarded verbatim to the service worker):
 *   ['title' => '...', 'body' => '...', 'url' => '/#events', 'tag' => '...']
 *
 * Returns ['sent' => N, 'total' => M, 'pruned' => K] or null on transport
 * error. Endpoints that come back as 404/410 are pruned from the JSON store
 * so we don't keep waking up dead browsers.
 *
 * Requires these constants from config.php:
 *   PRIVATE_DIR, PUSH_SENDER_URL, PUSH_SENDER_SECRET
 */

function _pushReadSubs(): array {
    $file = PRIVATE_DIR . '/push-subscriptions.json';
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return $data['itemListElement'] ?? [];
}

function _pushFilterFanoutShape(array $items): array {
    // Caller wants what web-push expects: { endpoint, keys: { p256dh, auth } }.
    $out = [];
    foreach ($items as $row) {
        if (empty($row['endpoint']) || empty($row['keys']['p256dh']) || empty($row['keys']['auth'])) continue;
        $out[] = [
            'endpoint' => $row['endpoint'],
            'keys'     => ['p256dh' => $row['keys']['p256dh'], 'auth' => $row['keys']['auth']],
        ];
    }
    return $out;
}

function _pushSend(array $subs, array $payload): ?array {
    if (!$subs) return ['sent' => 0, 'total' => 0, 'pruned' => 0];

    $ch = curl_init(rtrim(PUSH_SENDER_URL, '/') . '/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . PUSH_SENDER_SECRET,
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'payload'       => $payload,
            'subscriptions' => $subs,
        ]),
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false || $code < 200 || $code >= 300) {
        error_log('[push] sender returned HTTP ' . $code);
        return null;
    }

    $body  = json_decode($resp, true) ?: [];
    $gone  = $body['gone'] ?? [];
    $sent  = (int) ($body['sent']  ?? 0);
    $total = (int) ($body['total'] ?? count($subs));

    $pruned = 0;
    if ($gone) {
        $pruned = _pushPruneEndpoints($gone);
    }

    return ['sent' => $sent, 'total' => $total, 'pruned' => $pruned];
}

function _pushPruneEndpoints(array $endpoints): int {
    if (!$endpoints) return 0;
    $file = PRIVATE_DIR . '/push-subscriptions.json';
    $drop = array_flip($endpoints);
    return (int) writeJSONSafe($file, function (&$data) use ($drop) {
        $items = $data['itemListElement'] ?? [];
        $kept  = [];
        $removed = 0;
        foreach ($items as $entry) {
            if (isset($entry['endpoint'], $drop[$entry['endpoint']])) { $removed++; continue; }
            $kept[] = $entry;
        }
        $data['itemListElement'] = $kept;
        $data['numberOfItems']   = count($kept);
        return $removed;
    });
}

function pushBroadcast(array $payload): ?array {
    $items = _pushReadSubs();
    return _pushSend(_pushFilterFanoutShape($items), $payload);
}

function pushToUsers(array $userIds, array $payload): ?array {
    if (!$userIds) return ['sent' => 0, 'total' => 0, 'pruned' => 0];
    $allow = array_flip($userIds);
    $items = array_filter(_pushReadSubs(), fn($e) => isset($e['userId'], $allow[$e['userId']]));
    return _pushSend(_pushFilterFanoutShape(array_values($items)), $payload);
}
