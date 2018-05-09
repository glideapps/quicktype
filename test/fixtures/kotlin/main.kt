package quicktype

import java.io.File
import java.io.InputStream

fun output(json: String) {
  val bytes = json.toByteArray()
  System.out.write(bytes, 0, bytes.size)
}

fun main(args: Array<String>) {
	val json = File("sample.json").readText(Charsets.UTF_8)
	val top = TopLevel.fromJson(json)!!
	output(top.toJson())
}
