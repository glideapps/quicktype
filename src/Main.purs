module Main where

import Prelude

import Control.Monad.Eff (Eff)
import Control.Monad.Eff.Console (CONSOLE)
import Control.Monad.Eff.Console as C
import Data.Argonaut.Core (JArray, JBoolean, JNull, JString, Json, JObject, foldJson, foldJsonObject)
import Data.Argonaut.Parser (jsonParser)
import Data.Array (length, toUnfoldable, (:), concat, (!!), foldMap, concatMap)
import Data.Either (Either)
import Data.Maybe (fromJust)
import Data.StrMap (StrMap, fromFoldable, keys, values, foldMap, toUnfoldable) as StrMap
import Data.Tuple (uncurry, Tuple(..), fst, snd)
import Partial.Unsafe (unsafePartial)

data IRClassData = IRClassData { name :: String, properties :: StrMap.StrMap IRType }
data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass IRClassData
    | IRUnion (Array IRType)

makeTypeFromJson :: String -> Json -> IRType
makeTypeFromJson name json = foldJson
    (const $ IRNull)
    (\b -> IRBool)
    (\x -> IRDouble)
    (\s -> IRString)
    (case _ of
        [] -> IRArray IRNothing
        a ->
            let elementType = makeTypeFromJson (singularize name) (unsafePartial $ fromJust $ a !! 0) in
            IRArray elementType)
    (\o ->
        let props = mapProperties o in
        IRClass (IRClassData { name: name, properties: props }))
    json

mapProperties :: StrMap.StrMap Json -> StrMap.StrMap IRType
mapProperties sm = StrMap.fromFoldable results
  where mapper (Tuple n j) = Tuple n (makeTypeFromJson n j)
        results = map mapper (unfold sm)

singularize :: String -> String
singularize s = "OneOf" <> s

-- This is a travesty.  Try putting this function definition
-- in the where clause below.
unfold :: forall a. StrMap.StrMap a -> Array (Tuple String a)
unfold sm = StrMap.toUnfoldable sm

gatherClassesFromType :: IRType -> Array IRClassData
gatherClassesFromType (IRClass classData) =
    let IRClassData { name, properties } = classData in
    classData : (concatMap gatherClassesFromType (StrMap.values properties))
gatherClassesFromType (IRArray t) = gatherClassesFromType t
gatherClassesFromType _ = []

renderTypeToCSharp :: IRType -> String
renderTypeToCSharp IRNothing = "object"
renderTypeToCSharp IRNull = "object"
renderTypeToCSharp IRInteger = "int"
renderTypeToCSharp IRDouble = "double"
renderTypeToCSharp IRBool = "bool"
renderTypeToCSharp IRString = "string"
renderTypeToCSharp (IRArray a) = (renderTypeToCSharp a) <> "[]"
renderTypeToCSharp (IRClass (IRClassData { name, properties })) = name
renderTypeToCSharp (IRUnion _) = "FIXME"

renderClassToCSharp :: IRClassData -> String
renderClassToCSharp (IRClassData { name, properties }) =
    "class " <> name <> """
{""" <>
    StrMap.foldMap (\n -> \t -> "\n" <> nameToProperty n t) properties
    <> """
}
"""
    where nameToProperty name irType = "    public " <> (renderTypeToCSharp irType) <> " " <> name <> " { get; set; }"

renderClassesToCSharp :: Array IRClassData -> String
renderClassesToCSharp classes =
    foldMap (\c -> (renderClassToCSharp c) <> "\n\n") classes

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeFromJson "TopLevel"
    <#> gatherClassesFromType
    <#> renderClassesToCSharp
