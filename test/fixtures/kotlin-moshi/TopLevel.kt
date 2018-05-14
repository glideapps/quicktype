// To parse the JSON, install Moshi and do:
//
//   val topLevel = TopLevel.fromJson(jsonString)

package quicktype

import com.squareup.moshi.*
import com.squareup.moshi.kotlin.KotlinJsonAdapterFactory

private val moshi = Moshi.Builder()
    .add(KotlinJsonAdapterFactory())
    .build()

data class TopLevel (
    val stringValue: String,
    val dateValue: String,
    val uuidValue: String,

    @Json(name = "name with spaces")
    val nameWithSpaces: Any? = null,

    val doubleValue: Double,
    val intValue: Long,
    val booleanValue: Boolean,
    val nullValue: Any? = null,
    val tuples: List<List<IntOrString>>,
    val person: PurplePerson,
    val people: List<PersonElement>,
    val differentThings: List<DifferentThingElement>,
    val mapValue: Map<String, Long?>,
    val nullableMapValue: Map<String, Long?>
) {
    public fun toJson() = TopLevel.adapter.toJson(this)

    companion object {
        val adapter = moshi.adapter(TopLevel::class.java)
        public fun fromJson(json: String) = adapter.fromJson(json)
    }
}

sealed class DifferentThingElement {
    class DifferentThingClassValue(val value: DifferentThingClass) : DifferentThingElement()
    class IntegerValue(val value: Long)                            : DifferentThingElement()
    class StringValue(val value: String)                           : DifferentThingElement()
}

data class DifferentThingClass (
    val name: String
)

data class PersonElement (
    val name: String,
    val intOrString: IntOrString,
    val optionalValue: Boolean? = null
)

sealed class IntOrString {
    class IntegerValue(val value: Long)  : IntOrString()
    class StringValue(val value: String) : IntOrString()
}

data class PurplePerson (
    val name: String,
    val intOrString: Long
)
