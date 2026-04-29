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
    $ch2 = curl_init(SUPABASE_URL . '/rest/v1/users');
    curl_setopt_array($ch2, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['apikey: ' . SUPABASE_SERVICE_KEY, 'Authorization: Bearer ' . SUPABASE_SERVICE_KEY, 'Content-Type: application/json', 'Prefer: return=representation'], CURLOPT_CUSTOMREQUEST => 'POST', CURLOPT_POSTFIELDS => json_encode(['id' => $userId, 'name' => ($supaUser['user_metadata']['full_name'] ?? $supaUser['email']), 'email' => $supaUser['email'], 'image' => ($supaUser['user_metadata']['avatar_url'] ?? ''), 'role' => 'lector', 'display_name' => ($supaUser['user_metadata']['full_name'] ?? $supaUser['email'])])]);
    $dbg = curl_exec($ch2); $code = curl_getinfo($ch2, CURLINFO_HTTP_CODE); curl_close($ch2);
    echo json_encode(['error' => 'Error creant usuari', 'supabase_code' => $code, 'supabase_response' => json_decode($dbg, true)]);
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
