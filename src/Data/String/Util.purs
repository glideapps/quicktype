module Data.String.Util
    ( plural
    , singular
    , capitalize
    , decapitalize
    , camelCase
    , intToHex
    , genericStringEscape
    , stringEscape
    , standardUnicodeHexEscape
    , times
    , legalizeCharacters
    , isLetterOrUnderscore
    , isLetterOrUnderscoreOrDigit
    , isLetterOrLetterNumber
    , startWithLetter
    , isInt
    ) where

import Prelude

import Data.Array as A
import Data.Char (toCharCode)
import Data.Char.Unicode (GeneralCategory(..), generalCategory, isDigit, isLetter, isPrint)
import Data.Either as Either
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.Char as Char
import Data.String as S
import Data.String.Regex as Rx
import Data.String.Regex.Flags as RxFlags
import Partial.Unsafe (unsafePartial)

foreign import _plural :: String -> String
foreign import _singular :: String -> String
foreign import isInt :: String -> Boolean
foreign import internalStringEscape :: (Char -> String) -> String -> String

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

intToHex :: Int -> Int -> Array Char
intToHex width number =
    let arr = S.toCharArray $ Int.toStringAs Int.hexadecimal number
        len = A.length arr
    in
        if len < width then
            A.replicate (width - len) '0' <> arr
        else
            arr

standardUnicodeHexEscape :: Int -> String
standardUnicodeHexEscape i =
    if i <= 0xffff then
        "\\u" <> (S.fromCharArray $ intToHex 4 i)
    else
        "\\U" <> (S.fromCharArray $ intToHex 8 i)

genericStringEscape :: (Int -> String) -> String -> String
genericStringEscape f =
    internalStringEscape mapper
    where
        mapper c =
            if isPrint c then
                S.fromCharArray [c]
            else
                f $ Char.toCharCode c

stringEscape :: String -> String
stringEscape = genericStringEscape standardUnicodeHexEscape

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)

legalizeCharacters :: (Char -> Boolean) -> String -> String
legalizeCharacters isLegal str =
    S.fromCharArray $ map (\c -> if isLegal c then c else '_') $ S.toCharArray str

isLetterOrLetterNumber :: Char -> Boolean
isLetterOrLetterNumber c =
    isLetter c || (generalCategory c == Just LetterNumber)

isLetterOrUnderscore :: Char -> Boolean
isLetterOrUnderscore c =
    isLetter c || c == '_'

isLetterOrUnderscoreOrDigit :: Char -> Boolean
isLetterOrUnderscoreOrDigit c =
    isLetterOrUnderscore c || isDigit c

startWithLetter :: (Char -> Boolean) -> Boolean -> String -> String
startWithLetter isLetter upper str =
    let modify = if upper then capitalize else decapitalize
    in case S.charAt 0 str of
    Nothing -> modify "empty"
    Just s ->
        if isLetter s then
            modify str
        else
            modify $ "the" <> str
