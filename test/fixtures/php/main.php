#!/usr/bin/php
<?php

error_reporting(E_ALL ^ E_WARNING); 
require_once("./TopLevel.php");

$json_string_in = file_get_contents($argv[1]);
$json_in = json_decode($json_string_in);
$data = TopLevel::from($json_in);
$json_out = $data->to();
$json_string_out = json_encode($json_out);

echo($json_string_out);

?>
