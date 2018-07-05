import 'dart:convert';
import 'dart:io';
import 'dart:async';
import 'TopLevel.dart';

void main(List<String> arguments) async {
  final path = arguments[0];
  new File(path).readAsString().then((String contents) async {
    final jsonData = json.decode(contents);
    var topLevel = jsonData is List
        ? new List.from((jsonData)
            .map((f) => new TopLevel.fromJson(f as Map<String, dynamic>)))
        : new TopLevel.fromJson(jsonData);
    var map = (topLevel is List)
        ? new List.from((topLevel).map((f) => (f is TopLevel) ? f.toJson() : f))
        : (topLevel as TopLevel).toJson();
    var returnJson = json.encode(map);
    final output = new File("output.json");
    await output.writeAsString(returnJson, mode: FileMode.write);
    stdout.write(returnJson);
  });
}
