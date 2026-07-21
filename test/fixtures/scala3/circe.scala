//> using scala "3.2.2"
//> using dep "io.circe::circe-core:0.14.5"
//> using dep "io.circe::circe-parser:0.14.5"
//> using options "-Xmax-inlines", "3000"

package quicktype

import io.circe._
import io.circe.parser._
import io.circe.syntax._

@main def main = {
  val json = scala.io.Source.fromFile("sample.json").getLines.mkString
  // `scala.` in case the generated code has types named Right/Left.
  parse(json).flatMap(_.as[TopLevel]) match {
    case scala.Right(y) =>
      val arr: Array[Byte] = y.asJson.toString.getBytes("UTF-8")
      System.out.write(arr, 0, arr.length)
    case scala.Left(err) =>
      System.err.println(err)
      sys.exit(1)
  }
}
