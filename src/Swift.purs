module Swift where

import Prelude

import Data.Foldable (for_)
import Data.Maybe (Maybe(..), fromMaybe)

import Doc (Doc, indent, line, string, words)

data SType =
    Struct
    { name :: Maybe String
    , fields :: Array TValue
    }

data TPrim = TString | TInt | TArray TPrim | TExtern String

type TValue = { name :: String, typ :: TPrim }

renderSwift :: SType -> Doc Unit
renderSwift (Struct { name, fields }) = do
    line $ words ["struct", fromMaybe "MyStruct" name]
    line "{"
    indent do
        for_ fields renderValue
    line "}"

renderValue :: TValue -> Doc Unit
renderValue { name, typ } = line do
    words ["let", name <> ":"]
    string " "
    renderTPrim typ

renderTPrim :: TPrim -> Doc Unit
renderTPrim TString = string "string"
renderTPrim TInt = string "int"
renderTPrim (TArray typ) =  do
    string "["
    renderTPrim typ
    string "]"
renderTPrim (TExtern name) = string name

sample :: SType
sample = Struct
    { name: Just "Person"
    , fields:
        [ { name: "name", typ: TString }
        , { name: "age", typ: TInt }
        , { name: "friends", typ: TArray TString }
        ]
    }