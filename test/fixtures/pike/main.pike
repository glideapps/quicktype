import .TopLevel;

int main (int argc, array(string) argv) {
  Stdio.File f = Stdio.File(argv[1], "r");

  mixed json = Standards.JSON.decode(f.read());
  TopLevel tl = TopLevel_from_JSON(json);
  string to_json = Standards.JSON.encode(tl, Standards.JSON.HUMAN_READABLE);

  write(to_json);

  return 0;
}