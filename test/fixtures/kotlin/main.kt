package quicktype

import java.io.File
import java.io.InputStream

fun main(args: Array<String>) {
	val json = File("sample.json").readText(Charsets.UTF_8)
	val top = TopLevel.fromJson(json)!!
	println(top.toJson())
}
