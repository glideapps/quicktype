module Data.String.Util where

import Prelude

import Data.Maybe (Maybe(..))
import Data.String as S

foreign import _plural :: String -> String
foreign import _singular :: String -> String

plural :: String -> String
plural = _plural

singular :: String -> String
singular = _singular

capitalize :: String -> String
capitalize "" = ""
capitalize s = case S.uncons s of
    Just { head, tail } -> S.toUpper (S.singleton head) <> tail
    _ -> s

camelCase :: String -> String
camelCase = S.split (S.Pattern "_") >>> map capitalize >>> S.joinWith ""