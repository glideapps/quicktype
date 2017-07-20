module Data.String.Util where

import Prelude

import Data.Argonaut.Core (toArray)
import Data.Array (length, replicate)
import Data.Array as A
import Data.Char (fromCharCode, toCharCode)
import Data.Int.Bits (shr, and)
import Data.Maybe (Maybe(..))
import Data.String (fromCharArray)
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

intToHex :: Int -> Int -> String
intToHex width number =
    let arr = toArray number
        len = A.length arr
        fullArr = if len < width then A.replicate (width - len) '0' <> arr else arr
    in
        S.fromCharArray fullArr
    where
        toDigit i =
            if i < 10 then
                fromCharCode $ i + toCharCode '0'
            else
                fromCharCode $ i - 10 + toCharCode 'a'
        toArray i =
            if i == 0 then
                []
            else
                (toArray $ shr i 4) <> [toDigit $ and i 15]