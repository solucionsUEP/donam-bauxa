<?php
/**
 * POST /api/admin/announce — admin sends a push to every subscriber.
 *
 * Body: { "title": "...", "body": "...", "url"?: "/#events" }
 */

require_once __DIR__ . '/../helpers/push.php';

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
    return;
}

requireRole(['admin']);

$title = trim((string) ($body['title'] ?? ''));
$msg   = trim((string) ($body['body']  ?? ''));
$url   = trim((string) ($body['url']   ?? '/'));

if ($title === '' || $msg === '') {
    http_response_code(400);
    echo json_encode(['error' => 'title i body obligatoris']);
    return;
}

$result = pushBroadcast([
    'title' => $title,
    'body'  => $msg,
    'url'   => $url,
    'tag'   => 'announcement',
]);

if ($result === null) {
    http_response_code(502);
    echo json_encode(['error' => 'No s\'ha pogut contactar amb el sender']);
    return;
}

echo json_encode(['ok' => true] + $result);
