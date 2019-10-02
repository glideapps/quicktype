// To parse the JSON, install Klaxon and do:
//
//   val pokedex = Pokedex.fromJson(jsonString)

package quicktype

import com.beust.klaxon.*

private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) =
    this.converter(object: Converter {
        @Suppress("UNCHECKED_CAST")
        override fun toJson(value: Any)        = toJson(value as T)
        override fun fromJson(jv: JsonValue)   = fromJson(jv) as Any
        override fun canConvert(cls: Class<*>) = cls == k.java || (isUnion && cls.superclass == k.java)
    })

private val klaxon = Klaxon()
    .convert(Egg::class,  { Egg.fromValue(it.string!!) },  { "\"${it.value}\"" })
    .convert(Type::class, { Type.fromValue(it.string!!) }, { "\"${it.value}\"" })

data class Pokedex (
    val pokemon: List<Pokemon>
) {
    public fun toJson() = klaxon.toJsonString(this)

    companion object {
        public fun fromJson(json: String) = klaxon.parse<Pokedex>(json)
    }
}

data class Pokemon (
    val id: Long,
    val num: String,
    val name: String,
    val img: String,
    val type: List<Type>,
    val height: String,
    val weight: String,
    val candy: String,

    @Json(name = "candy_count")
    val candyCount: Long? = null,

    val egg: Egg,

    @Json(name = "spawn_chance")
    val spawnChance: Double,

    @Json(name = "avg_spawns")
    val avgSpawns: Double,

    @Json(name = "spawn_time")
    val spawnTime: String,

    val multipliers: List<Double>? = null,
    val weaknesses: List<Type>,

    @Json(name = "next_evolution")
    val nextEvolution: List<Evolution>? = null,

    @Json(name = "prev_evolution")
    val prevEvolution: List<Evolution>? = null
)

enum class Egg(val value: String) {
    NotInEggs("Not in Eggs"),
    OmanyteCandy("Omanyte Candy"),
    The10KM("10 km"),
    The2KM("2 km"),
    The5KM("5 km");

    companion object {
        public fun fromValue(value: String): Egg = when (value) {
            "Not in Eggs"   -> NotInEggs
            "Omanyte Candy" -> OmanyteCandy
            "10 km"         -> The10KM
            "2 km"          -> The2KM
            "5 km"          -> The5KM
            else            -> throw IllegalArgumentException()
        }
    }
}

data class Evolution (
    val num: String,
    val name: String
)

enum class Type(val value: String) {
    Bug("Bug"),
    Dark("Dark"),
    Dragon("Dragon"),
    Electric("Electric"),
    Fairy("Fairy"),
    Fighting("Fighting"),
    Fire("Fire"),
    Flying("Flying"),
    Ghost("Ghost"),
    Grass("Grass"),
    Ground("Ground"),
    Ice("Ice"),
    Normal("Normal"),
    Poison("Poison"),
    Psychic("Psychic"),
    Rock("Rock"),
    Steel("Steel"),
    Water("Water");

    companion object {
        public fun fromValue(value: String): Type = when (value) {
            "Bug"      -> Bug
            "Dark"     -> Dark
            "Dragon"   -> Dragon
            "Electric" -> Electric
            "Fairy"    -> Fairy
            "Fighting" -> Fighting
            "Fire"     -> Fire
            "Flying"   -> Flying
            "Ghost"    -> Ghost
            "Grass"    -> Grass
            "Ground"   -> Ground
            "Ice"      -> Ice
            "Normal"   -> Normal
            "Poison"   -> Poison
            "Psychic"  -> Psychic
            "Rock"     -> Rock
            "Steel"    -> Steel
            "Water"    -> Water
            else       -> throw IllegalArgumentException()
        }
    }
}
