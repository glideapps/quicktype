module Main where

import Prelude

import Control.Monad.Eff (Eff)
import Control.Monad.Eff.Console (CONSOLE)
import Control.Monad.Eff.Console as C
import Data.Argonaut.Core (Json, foldJsonObject)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either(..))
import Data.Foldable (foldMap)
import Data.StrMap as StrMap

json :: String
json = """
{
    "name": "David",
    "age": 31
}
"""

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

jsonToCSharpE :: String -> Either String String
jsonToCSharpE json =
    case jsonParser json of
      Left error -> Left error
      Right j -> Right $ renderCSharpType $ jsonToCSharpType $ j

jsonToCSharp :: String -> String
jsonToCSharp json = 
    case jsonParser json of
      Left error -> error
      Right j -> renderCSharpType $ jsonToCSharpType $ j

main :: forall e. Eff (console :: CONSOLE | e) Unit
main = do
    C.log "Hi!"

    