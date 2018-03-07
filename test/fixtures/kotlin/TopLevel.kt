// To parse the JSON, add this file to your project and do:
//
//   val topLevel = TopLevel.fromJson(jsonString)

import com.beust.klaxon.*

private val klaxon =
    Klaxon()

data class TopLevel (
    val name: String
) {
    public fun toJson() = klaxon.toJsonString(this as Any)

    companion object {
        public fun fromJson(json: String) = klaxon.parse<TopLevel>(json)
    }
}
