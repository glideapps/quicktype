Running KotlinXRenderer
// To parse the JSON, install kotlin's serialization plugin and do:
//
//   val pokedex = Pokedex.fromJson(jsonString)

package quicktype

import kotlinx.serialization.*
import kotlinx.serialization.json.*
import kotlinx.serialization.internal.*

private val json = Json(JsonConfiguration.Stable)
    .convert(Egg::class,  { Egg.fromValue(it.string!!) },  { "\"${it.value}\"" })
    .convert(Type::class, { Type.fromValue(it.string!!) }, { "\"${it.value}\"" })

@Serializable
data class Pokedex (
    val pokemon: List<Pokemon>
)

@Serializable
data class Pokemon (
    val id: Long,
    val num: String,
    val name: String,
    val img: String,
    val type: List<Type>,
    val height: String,
    val weight: String,
    val candy: String,
    val candyCount: Long? = null,
    val egg: Egg,
    val spawnChance: Double,
    val avgSpawns: Double,
    val spawnTime: String,
    val multipliers: List<Double>? = null,
    val weaknesses: List<Type>,
    val nextEvolution: List<Evolution>? = null,
    val prevEvolution: List<Evolution>? = null
)

@Serializable(with = Egg.Companion::class)
enum class Egg(val value: String) {
    NotInEggs("Not in Eggs"),
    OmanyteCandy("Omanyte Candy"),
    The10KM("10 km"),
    The2KM("2 km"),
    The5KM("5 km");

    companion object : KSerializer<Egg> {
        override val descriptor: SerialDescriptor get() {
            return StringDescriptor
        }
        override fun deserialize(decoder: Decoder): Egg = when (decoder.decodeString()) {
            "Not in Eggs"   -> NotInEggs
            "Omanyte Candy" -> OmanyteCandy
            "10 km"         -> The10KM
            "2 km"          -> The2KM
            "5 km"          -> The5KM
            else            -> throw IllegalArgumentException()
        }
        override fun serialize(encoder: Encoder, obj: Egg) {
            return encoder.encodeString(obj.value)
        }
    }
}

@Serializable
data class Evolution (
    val num: String,
    val name: String
)

@Serializable(with = Type.Companion::class)
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

    companion object : KSerializer<Type> {
        override val descriptor: SerialDescriptor get() {
            return StringDescriptor
        }
        override fun deserialize(decoder: Decoder): Type = when (decoder.decodeString()) {
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
        override fun serialize(encoder: Encoder, obj: Type) {
            return encoder.encodeString(obj.value)
        }
    }
}
