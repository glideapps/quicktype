//> using scala "3.1.1"
//> using lib "com.lihaoyi::upickle:1.6.0"


package quicktype


object OptionPickler extends upickle.AttributeTagged {
  
  import upickle.default.Writer
  import upickle.default.Reader
  override implicit def OptionWriter[T: Writer]: Writer[Option[T]] =
    implicitly[Writer[T]].comap[Option[T]] {
      case None => null.asInstanceOf[T]
      case Some(x) => x
    }

  override implicit def OptionReader[T: Reader]: Reader[Option[T]] = {
    new Reader.Delegate[Any, Option[T]](implicitly[Reader[T]].map(Some(_))){
      override def visitNull(index: Int) = None
    }
  }
}

@main def main =
	import quicktype.OptionPickler._
	val json =  scala.io.Source.fromFile("sample.json").getLines.mkString
	//implicit val rw : ReadWriter[quicktype.TopLevel] = macroRW
	val output = read[TopLevel](json)
	val arr : Array[Byte] = write(output).getBytes("UTF-8");
	System.out.write(arr, 0, arr.length);

