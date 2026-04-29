<?php
// GET /auth/me

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Mètode no permès']);
    return;
}

$supaUser = getSupabaseUser();
if (!$supaUser) {
    echo json_encode(['authenticated' => false]);
    return;
}

$userId = $supaUser['id'];
$userRow = sbSelectOne('users', ['id' => 'eq.' . $userId]);

if (!$userRow) {
    $meta      = $supaUser['user_metadata'] ?? [];
    $fullName  = $meta['full_name'] ?? ($supaUser['email'] ?? '');
    $avatarUrl = $meta['avatar_url'] ?? '';

    $userRow = sbInsert('users', [
        'id'           => $userId,
        'name'         => $fullName,
        'email'        => $supaUser['email'] ?? '',
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
        'email' => $supaUser['email'] ?? '',
        'name'  => ($supaUser['user_metadata']['full_name'] ?? ''),
    ],
    'profile' => [
        '@id'         => $userRow['id'],
        'role'        => $userRow['role'],
        'displayName' => $userRow['display_name'] ?? $userRow['name'],
        'image'       => $userRow['image'] ?? '',
        'description' => $userRow['description'] ?? '',
    ],
]);
