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

data CSharpClass = CSClass { name :: String, properties :: StrMap.StrMap CSharpType } 
data CSharpType
    = CSClassType CSharpClass
    | CSArray CSharpType
    | CSObject
    | CSBool
    | CSDouble
    | CSString

makeCSharpTypeFromJson :: String -> Json -> CSharpType
makeCSharpTypeFromJson name json = foldJson
    (const $ CSObject)
    (\b -> CSBool)
    (\x -> CSDouble)
    (\s -> CSString)
    (case _ of
        [] -> CSArray CSObject
        a ->
            let elementType = makeCSharpTypeFromJson (singularize name) (unsafePartial $ fromJust $ a !! 0) in
            CSArray elementType)
    (\o ->
        let props = mapProperties o in
        CSClassType (CSClass { name: name, properties: props }))
    json

mapProperties :: StrMap.StrMap Json -> StrMap.StrMap CSharpType
mapProperties sm = StrMap.fromFoldable results
  where mapper (Tuple n j) = Tuple n (makeCSharpTypeFromJson n j)
        results = map mapper (unfold sm)

singularize :: String -> String
singularize s = "OneOf" <> s

-- This is a travesty.  Try putting this function definition
-- in the where clause below.
unfold :: forall a. StrMap.StrMap a -> Array (Tuple String a)
unfold sm = StrMap.toUnfoldable sm

gatherClassesFromType :: CSharpType -> Array CSharpClass
gatherClassesFromType (CSClassType c) =
    let CSClass { name, properties } = c in
    c : (concatMap gatherClassesFromType (StrMap.values properties))
gatherClassesFromType (CSArray t) = gatherClassesFromType t
gatherClassesFromType _ = []

renderCSharpType :: CSharpType -> String
renderCSharpType (CSArray a) = (renderCSharpType a) <> "[]"
renderCSharpType (CSClassType (CSClass { name, properties })) = name
renderCSharpType CSObject = "object"
renderCSharpType CSBool = "bool"
renderCSharpType CSDouble = "double"
renderCSharpType CSString = "string"

renderCSharpClass :: CSharpClass -> String
renderCSharpClass (CSClass { name, properties }) =
    "class " <> name <> """
{""" <>
    StrMap.foldMap (\n -> \t -> "\n" <> nameToProperty n t) properties
    <> """
}
"""
    where nameToProperty name csType = "    public " <> (renderCSharpType csType) <> " " <> name <> " { get; set; }"

renderCSharpClasses :: Array CSharpClass -> String
renderCSharpClasses classes =
    foldMap (\c -> (renderCSharpClass c) <> "\n\n") classes

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeCSharpTypeFromJson "TopLevel"
    <#> gatherClassesFromType
    <#> renderCSharpClasses
