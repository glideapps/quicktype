//> using scala "3.1.1"
//> using lib "io.circe::circe-core:0.15.0-M1"
//> using lib "io.circe::circe-parser:0.15.0-M1"
//> using options "-Xmax-inlines", "2000"
//> using lib "com.lihaoyi::os-lib:0.8.0"

package quicktype

import io.circe._
import io.circe.parser._
import io.circe.syntax._
/* 

case class TopLevel (
    val data : Long,
    val next : Option[TopLevel] = None 
) derives Encoder.AsObject, Decoder */


@main def main =	
	val json =  scala.io.Source.fromFile("sample.json").getLines.mkString	
	
	parse(json).map(x => 
		val arg = x.as[TopLevel]
		arg match {
			case Right(y) => 
				val jsonString = y.asJson
				val arr : Array[Byte] = jsonString.toString.getBytes("UTF-8")
				//os.write.over(os.pwd / "out.json", jsonString.noSpaces.toString)
				System.out.write(arr, 0, arr.length)
			case Left(y) => println(y); println("-----");println(y.getMessage)
		} 			
	)
