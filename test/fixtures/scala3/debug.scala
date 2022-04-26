//> using scala "3.1.1"
//> using lib "com.lihaoyi::upickle:1.6.0"


package quicktype

/* case class TopLevel (val name: String)

given re : ReadWriter[TopLevel] = macroRW
 */
@main def main =
	val json =  scala.io.Source.fromFile("/Users/simon/Code/quicktype/test/inputs/json/samples/github-events.json").getLines.mkString
	val output = ujson.read(json)
	val arr : Array[Byte] = ujson.write(output).getBytes("UTF-8");
	System.out.write(arr, 0, arr.length);

