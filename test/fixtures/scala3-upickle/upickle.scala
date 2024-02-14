//> using scala "3.2.2"
//> using lib "com.lihaoyi::upickle:3.1.0"
//> using lib "com.lihaoyi::os-lib:0.9.1"
//> using options "-Xmax-inlines", "500000"

package quicktype
import upickle.default.*


@main def main = {	  
  val json =  scala.io.Source.fromFile("sample.json").getLines.mkString		
  val parsed = OptionPickler.read[TopLevel](json)
  val jsonString = OptionPickler.writeJs(parsed)
  val arr : Array[Byte] = jsonString.toString.getBytes("UTF-8")
  // os.write(os.pwd / "my.json", OptionPickler.write(parsed, 2))
  System.out.write(arr, 0, arr.length)	
}
