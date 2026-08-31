import .TopLevel;

int main (int argc, array(string) argv) {
  Stdio.File f = Stdio.File(argv[1], "r");

  mixed json = Standards.JSON.decode(utf8_to_string(f.read()));
  TopLevel tl = TopLevel_from_JSON(json);
  string to_json = Standards.JSON.encode(tl, Standards.JSON.HUMAN_READABLE);

  write(string_to_utf8(to_json));

  return 0;
}
