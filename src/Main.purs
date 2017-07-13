module Main where

import Prelude

import Data.Argonaut.Core (Json, foldJsonObject)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either)
import Data.Foldable (foldMap)
import Data.StrMap as StrMap

data CSharpType = Class { name :: String, properties :: Array String }

jsonToCSharpType :: Json -> CSharpType
jsonToCSharpType j = Class { name: "MyValue", properties }
    where properties = foldJsonObject [] StrMap.keys j

renderCSharpType :: CSharpType -> String
renderCSharpType (Class { name, properties }) = "class " <> name <> """
{""" <>
    foldMap (\n -> "\n" <> nameToProperty n) properties
    <> """
}
"""
    where nameToProperty name = "    public string " <> name <> " { get; set; }"

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> jsonToCSharpType
    <#> renderCSharpType