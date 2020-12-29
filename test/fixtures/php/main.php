<?php
require_once("quicktype.php");

$f = file_get_contents($argv[1]);
$obj = TopLevel::from(json_decode($f));
echo(json_encode($obj->to()));
