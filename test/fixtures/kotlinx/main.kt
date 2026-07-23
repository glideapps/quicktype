package quicktype

import java.io.File
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// explicitNulls = false makes kotlinx omit nulls when serializing, like the
// other Kotlin frameworks we test; the test harness runs this fixture with
// allowMissingNull.
val json = Json { allowStructuredMapKeys = true; explicitNulls = false }

fun output(text: String) {
	val bytes = text.toByteArray()
	System.out.write(bytes, 0, bytes.size)
}

fun main(args: Array<String>) {
	val text = File(args[0]).readText()
	val top = json.decodeFromString<TopLevel>(text)
	output(json.encodeToString(top))
}
