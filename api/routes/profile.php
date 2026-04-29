<?php
// GET /api/profile   PUT /api/profile

if ($method === 'GET') {
    $row = requireAuth();
    echo json_encode(['profile' => rowToProfile($row)]);

} elseif ($method === 'PUT') {
    $row = requireAuth();

    $updates = [];
    if (array_key_exists('displayName', $body)) $updates['display_name'] = $body['displayName'];
    if (array_key_exists('description',  $body)) $updates['description']  = $body['description'];

    if (empty($updates)) {
        echo json_encode(['profile' => rowToProfile($row)]);
        return;
    }

    $updated = sbUpdate('users', ['id' => 'eq.' . $row['id']], $updates);
    if (!$updated) {
        http_response_code(500);
        echo json_encode(['error' => 'Error actualitzant perfil']);
        return;
    }
    echo json_encode(['profile' => rowToProfile($updated)]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
}
