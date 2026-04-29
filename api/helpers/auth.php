<?php

// Valida el token contra l'API d'Auth de Supabase i retorna el user, o null.
function getSupabaseUser(): ?array {
    $headers = getallheaders();
    $auth = $headers['Authorization']
        ?? $headers['authorization']
        ?? $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';

    if (strncmp($auth, 'Bearer ', 7) !== 0) return null;
    $token = substr($auth, 7);

    $ch = curl_init(SUPABASE_URL . '/auth/v1/user');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . SUPABASE_SERVICE_KEY,
            'Authorization: Bearer ' . $token,
        ],
    ]);
    $response = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) return null;
    $user = json_decode($response, true);
    return (!empty($user['id'])) ? $user : null;
}

function getAuthUserRow(): ?array {
    $supaUser = getSupabaseUser();
    if (!$supaUser) return null;
    return sbSelectOne('users', ['id' => 'eq.' . $supaUser['id']]);
}

function requireAuth(): array {
    $row = getAuthUserRow();
    if (!$row) {
        http_response_code(401);
        echo json_encode(['error' => 'No autenticat']);
        exit;
    }
    return $row;
}

function requireRole(array $roles): array {
    $row = getAuthUserRow();
    if (!$row || !in_array($row['role'], $roles)) {
        http_response_code(403);
        echo json_encode(['error' => 'No autoritzat']);
        exit;
    }
    return $row;
}
