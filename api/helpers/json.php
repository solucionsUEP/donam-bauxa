<?php

$EMPTY_LIST = [
    '@context'       => 'https://schema.org',
    '@type'          => 'ItemList',
    'numberOfItems'  => 0,
    'itemListElement' => [],
];

function readJSON(string $filePath): array {
    global $EMPTY_LIST;
    if (!file_exists($filePath)) return $EMPTY_LIST;
    $content = file_get_contents($filePath);
    $data = json_decode($content, true);
    return is_array($data) ? $data : $EMPTY_LIST;
}

function writeJSON(string $filePath, array $data): void {
    $fh = fopen($filePath, 'c');
    if (!$fh) return;
    if (flock($fh, LOCK_EX)) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fh, LOCK_UN);
    }
    fclose($fh);
}

// Llegeix, aplica $updateFn i escriu de forma atòmica. Retorna el que retorni $updateFn.
function writeJSONSafe(string $filePath, callable $updateFn): mixed {
    $fh = fopen($filePath, 'c+');
    if (!$fh) return null;

    flock($fh, LOCK_EX);

    $content = stream_get_contents($fh);
    $data = json_decode($content, true);
    if (!is_array($data)) {
        global $EMPTY_LIST;
        $data = $EMPTY_LIST;
    }

    $result = $updateFn($data);

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    flock($fh, LOCK_UN);
    fclose($fh);

    return $result;
}

function generateId(string $prefix, array $items): array {
    $maxPos = 0;
    foreach ($items as $el) {
        $pos = $el['position'] ?? 0;
        if ($pos > $maxPos) $maxPos = $pos;
    }
    return ['id' => "$prefix-" . ($maxPos + 1), 'position' => $maxPos + 1];
}
