module Swift where

import Prelude

import Data.Foldable (foldMap)
import Data.Maybe (Maybe(..), fromMaybe)

data SType =
    Struct
    { name :: Maybe String
    , fields :: Array TValue
    }

data TPrim = TString | TInt | TArray TPrim | TExtern String

type TValue = { name :: String, typ :: TPrim }

render :: SType -> String
render (Struct { name, fields }) =
    """struct """ <> fromMaybe "MyStruct" name <> """
    {
    """ <>
    foldMap renderValue fields <>
    """
    }"""

renderValue :: TValue -> String
renderValue { name, typ } = "let " <> name <> ": " <> renderTPrim typ

renderTPrim :: TPrim -> String
renderTPrim TString = "string"
renderTPrim TInt = "int"
renderTPrim (TArray typ) = "[" <> renderTPrim typ <> "]"
renderTPrim (TExtern name) = name