<?php

function supabaseRequest(string $method, string $table, array $filters = [], ?array $body = null) {
    $url = SUPABASE_URL . '/rest/v1/' . $table;
    if ($filters) {
        $url .= '?' . http_build_query($filters);
    }

    $headers = [
        'apikey: ' . SUPABASE_SERVICE_KEY,
        'Authorization: Bearer ' . SUPABASE_SERVICE_KEY,
        'Content-Type: application/json',
    ];
    if (in_array($method, ['POST', 'PATCH'])) {
        $headers[] = 'Prefer: return=representation';
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_CUSTOMREQUEST  => $method,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }

    $response = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 204) return true;
    if ($httpCode >= 400) return null;

    return json_decode($response, true);
}

function sbSelect(string $table, array $filters = [], ?string $order = null): array {
    if ($order) $filters['order'] = $order;
    $result = supabaseRequest('GET', $table, $filters);
    return is_array($result) ? $result : [];
}

function sbSelectOne(string $table, array $filters): ?array {
    $result = supabaseRequest('GET', $table, $filters);
    if (!is_array($result) || empty($result)) return null;
    return $result[0];
}

function sbInsert(string $table, array $data): ?array {
    $result = supabaseRequest('POST', $table, [], $data);
    if (!is_array($result)) return null;
    return $result[0] ?? null;
}

function sbUpdate(string $table, array $filters, array $data): ?array {
    $result = supabaseRequest('PATCH', $table, $filters, $data);
    if (!is_array($result)) return null;
    return $result[0] ?? null;
}

function sbDelete(string $table, array $filters): bool {
    return supabaseRequest('DELETE', $table, $filters) !== null;
}

function rowToProfile(array $row): array {
    return [
        '@context'           => 'https://schema.org',
        '@type'              => 'Person',
        '@id'                => $row['id'],
        'identifier'         => $row['id'],
        'name'               => $row['name'],
        'email'              => $row['email'],
        'image'              => $row['image'] ?? '',
        'jobTitle'           => $row['role'],
        'description'        => $row['description'] ?? '',
        'additionalProperty' => [[
            '@type' => 'PropertyValue',
            'name'  => 'displayName',
            'value' => $row['display_name'] ?? $row['name'],
        ]],
        'dateCreated' => $row['created_at'],
    ];
}
