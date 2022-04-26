//> using scala "3.1.1"
//> using lib "com.lihaoyi::upickle:1.6.0"


package quicktype
import upickle.default._

@main def main =
	val json =  scala.io.Source.fromFile("sample.json").getLines.mkString
	//val output: String = upickle.default.read[TopLevel](json)
	val output = ujson.read(json)
	val arr : Array[Byte] = ujson.write(output).getBytes("UTF-8");
	System.out.write(arr, 0, arr.length);

