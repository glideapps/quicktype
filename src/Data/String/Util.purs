module Data.String.Util
    ( plural
    , singular
    , capitalize
    , decapitalize
    , camelCase
    , intToHex
    , stringEscape
    , times
    ) where

import Prelude

import Data.Array as A
import Data.Char (toCharCode)
import Data.Char.Unicode (isPrint)
import Data.Either as Either
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String (toLower)
import Data.String as S
import Data.String.Regex as Rx
import Data.String.Regex.Flags as RxFlags
import Partial.Unsafe (unsafePartial)

foreign import _plural :: String -> String
foreign import _singular :: String -> String

plural :: String -> String
plural = _plural

singular :: String -> String
singular = _singular

modifyFirstChar :: (String -> String) -> String -> String
modifyFirstChar _ "" = ""
modifyFirstChar f s = case S.uncons s of
    Just { head, tail } -> f (S.singleton head) <> tail
    _ -> s

capitalize :: String -> String
capitalize = modifyFirstChar S.toUpper

decapitalize :: String -> String
decapitalize = modifyFirstChar S.toLower

wordSeparatorRegex :: Rx.Regex
wordSeparatorRegex = unsafePartial $ Either.fromRight $ Rx.regex "[-_. ]" RxFlags.noFlags

camelCase :: String -> String
camelCase = Rx.split wordSeparatorRegex >>> map capitalize >>> S.joinWith ""

intToHex :: Int -> Int -> String
intToHex width number =
    let arr = S.toCharArray $ Int.toStringAs Int.hexadecimal number
        len = A.length arr
        fullArr = if len < width then A.replicate (width - len) '0' <> arr else arr
    in
        S.fromCharArray fullArr

stringEscape :: String -> String
stringEscape str =
    S.fromCharArray $ A.concatMap charRep $ S.toCharArray str
    where
        charRep c =
            case c of
            '\\' -> ['\\', '\\']
            '\"' -> ['\\', '\"']
            '\n' -> ['\\', 'n']
            '\t' -> ['\\', 't']
            _ ->
                if isPrint c then
                    [c]
                else
                    let i = toCharCode c
                    in
                        if i <= 0xffff then
                            S.toCharArray $ "\\u" <> intToHex 4 i
                        else
                            S.toCharArray $ "\\U" <> intToHex 8 i

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)