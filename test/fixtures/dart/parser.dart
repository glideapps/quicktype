import 'dart:io';
import 'TopLevel.dart';

void main(List<String> arguments) async {
  final path = arguments[0];
  new File(path).readAsString().then((String contents) async {
    final topLevel = topLevelFromJson(contents);
    final result = topLevelToJson(topLevel);
    stdout.write(result);
  });
}
