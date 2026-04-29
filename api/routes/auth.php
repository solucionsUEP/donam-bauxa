<?php
// GET /auth/me

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
    return;
}

$payload = getTokenPayload();
if (!$payload) {
    echo json_encode(['authenticated' => false]);
    return;
}

$userId = $payload['sub'] ?? null;
if (!$userId) {
    echo json_encode(['authenticated' => false]);
    return;
}

$userRow = sbSelectOne('users', ['id' => 'eq.' . $userId]);

if (!$userRow) {
    $meta      = $payload['user_metadata'] ?? [];
    $fullName  = $meta['full_name'] ?? ($payload['email'] ?? '');
    $avatarUrl = $meta['avatar_url'] ?? '';
    $email     = $payload['email'] ?? '';

    $userRow = sbInsert('users', [
        'id'           => $userId,
        'name'         => $fullName,
        'email'        => $email,
        'image'        => $avatarUrl,
        'role'         => 'lector',
        'display_name' => $fullName,
    ]);
}

if (!$userRow) {
    http_response_code(500);
    echo json_encode(['error' => 'Error creant usuari']);
    return;
}

echo json_encode([
    'authenticated' => true,
    'user'    => [
        'id'    => $userId,
        'email' => $payload['email'] ?? '',
        'name'  => $payload['user_metadata']['full_name'] ?? '',
    ],
    'profile' => [
        '@id'         => $userRow['id'],
        'role'        => $userRow['role'],
        'displayName' => $userRow['display_name'] ?? $userRow['name'],
        'image'       => $userRow['image'] ?? '',
        'description' => $userRow['description'] ?? '',
    ],
]);
