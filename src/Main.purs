module Main where

import Prelude

import Control.Monad.Eff (Eff)
import Control.Monad.Eff.Console (CONSOLE)
import Control.Monad.Eff.Console as C
import Data.Argonaut.Core (JArray, JBoolean, JNull, JString, Json, JObject, foldJson, foldJsonObject)
import Data.Argonaut.Parser (jsonParser)
import Data.Array (length, toUnfoldable, (:), concat, (!!), foldMap)
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

gatherCSharpClassesFromJson :: String -> Json -> Tuple CSharpType (Array CSharpClass)
gatherCSharpClassesFromJson name json = foldJson
    (const $ Tuple CSObject [])
    (\b -> Tuple CSBool [])
    (\x -> Tuple CSDouble [])
    (\s -> Tuple CSString [])
    (case _ of
        [] -> Tuple (CSArray CSObject) []
        a ->
            let Tuple et classes = gatherCSharpClassesFromJson (singularize name) (unsafePartial $ fromJust $ a !! 0) in
            Tuple (CSArray et) classes)
    (\o ->
        let Tuple props classes = mapProperties o
            c = CSClass { name: name, properties: props } in
        Tuple (CSClassType c) (c : classes))
    json

mapStrMap :: forall a b. (String -> a -> b) -> StrMap.StrMap a -> Array b
mapStrMap f sm = map (uncurry f) (StrMap.toUnfoldable sm)

singularize :: String -> String
singularize s = "OneOf" <> s

mapProperties :: StrMap.StrMap Json -> Tuple (StrMap.StrMap CSharpType) (Array CSharpClass)
mapProperties sm = Tuple propMap classes
  where mapper (Tuple n j) = let Tuple t classes = gatherCSharpClassesFromJson n j
                              in Tuple (Tuple n t) classes
        results = map mapper (StrMap.toUnfoldable sm)
        propMap = StrMap.fromFoldable $ map fst results
        classes = concat $ map snd results

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
    <#> gatherCSharpClassesFromJson "TopLevel"
    <#> snd
    <#> renderCSharpClasses
