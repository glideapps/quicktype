#!/usr/bin/php
<?php

error_reporting(E_ALL ^ E_WARNING); 
require_once("./TopLevel.php");

$json_string_in = file_get_contents($argv[1]);
$json_in = json_decode($json_string_in);
if (!class_exists("TopLevel")) {
    if (!is_object($json_in)) throw new Exception("Expected an object");
    $json_out = $json_in;
} elseif (is_array($json_in)) {
    $data = array_map(fn($item) => TopLevel::from($item), $json_in);
    $json_out = array_map(fn($item) => $item->to(), $data);
} elseif (is_object($json_in)) {
    $data = TopLevel::from($json_in);
    $json_out = $data->to();
} else {
    $data = TopLevel::from($json_in);
    $json_out = TopLevel::to($data);
}
$json_string_out = json_encode($json_out);

echo($json_string_out);

?>
