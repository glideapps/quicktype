module TypeScript 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter)
import Data.Foldable (for_, intercalate, maximum)

import Data.List as L

import Data.Map as M
import Data.Maybe (Maybe(Nothing, Just), maybe)
import Data.Set (Set)
import Data.Set as S

import Data.String as Str
import Data.String.Util as Str

import Data.String.Regex as Rx
import Data.String.Regex.Flags as RxFlags
import Data.String.Util (camelCase, capitalize)

import Data.Tuple (Tuple(..), fst)
import Partial.Unsafe (unsafePartial)
import Utils (mapM)
import Data.Either as Either

renderer :: Renderer
renderer =
    { name: "TypeScript"
    , aceMode: "typescript"
    , extension: "ts"
    , doc: typeScriptDoc
    , transforms:
        { nameForClass
        , unionName: Nothing
        , unionPredicate: Just unionPredicate
        , nextName: \s -> s <> "_"
        , forbiddenNames: []
        , topLevelNameFromGiven: id
        , forbiddenFromTopLevelNameGiven: const []
        }
    }

unionPredicate :: IRType -> Maybe (Set IRType)
unionPredicate = case _ of
    IRUnion ur ->
        let s = unionToSet ur
        in case nullableFromSet s of
            Nothing -> Just s
            _ -> Nothing
    _ -> Nothing      

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = interfaceNamify $ combineNames names

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType _ = false

isLetterCharacter :: Char -> Boolean
isLetterCharacter c =
    isLetter c || (generalCategory c == Just LetterNumber)

isStartCharacter :: Char -> Boolean
isStartCharacter c =
    isLetterCharacter c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Nothing -> false
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
    Just Format -> true
    _ -> isLetterCharacter c

legalizeIdentifier :: String -> String
legalizeIdentifier str =
    case Str.charAt 0 str of
    Nothing -> "Empty"
    Just s ->
        if isStartCharacter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier ("_" <> str)

renderUnion :: Set IRType -> Doc String
renderUnion s =
    case nullableFromSet s of
    Just x -> do
        rendered <- renderType x
        pure if isValueType x then rendered <> "?" else rendered
    Nothing -> do
        types <- mapM renderType $ L.fromFoldable s
        pure $ intercalate " | " types

renderType :: IRType -> Doc String
renderType = case _ of
    IRNothing -> pure "any" -- we can have arrays of nothing
    IRNull -> pure "any"
    IRInteger -> pure "number"
    IRDouble -> pure "number"
    IRBool -> pure "boolean"
    IRString -> pure "string"
    IRArray a -> do
        rendered <- renderType a
        pure $ rendered <> "[]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType t
        pure $ "Map<string, " <> rendered <> ">"
    IRUnion types -> renderUnion $ unionToSet types

interfaceNamify :: String -> String
interfaceNamify = Str.camelCase >>> Str.capitalize >>> legalizeIdentifier

propertyNamify :: String -> String
propertyNamify s
    | Rx.test needsQuotes s = "\"" <> s <> "\""
    | otherwise = s
    
needsQuotes :: Rx.Regex
needsQuotes = unsafePartial $ Either.fromRight $ Rx.regex "[-. ]" RxFlags.noFlags

typeScriptDoc :: Doc Unit
typeScriptDoc = do
    top <- getTopLevel >>= renderType
    line $ """// To parse this JSON data:
//
//     import * as """ <> top <> """ from "./""" <> top <> """;
//     let value = """ <> top <> """.fromJson(json);
//
"""      
    renderHelpers
    blank 
    classes <- getClasses
    for_ classes \(Tuple i cd) -> do
        interface <- lookupClassName i
        renderInterface cd interface
        blank

renderHelpers :: Doc Unit
renderHelpers = do
    top <- getTopLevel >>= renderType
    line $ "export function fromJson(json: string): " <> top <> " {"
    indent do
        line $ "return JSON.parse(json);"
    line "}"
    blank
    line $ "export function toJson(value: " <> top <> "): string {"
    indent do
        line $ "return JSON.stringify(value);"
    line "}"

renderInterface :: IRClassData -> String -> Doc Unit
renderInterface (IRClassData { names, properties }) className = do
    let propertyNames = transformNames propertyNamify (_ <> "_") (S.singleton className) $ map (\n -> Tuple n n) $ M.keys properties
    line $ "export interface " <> className <> " {"
    indent do
        let props = M.toUnfoldable properties :: Array _
        let resolved = props <#> \(Tuple a b) -> Tuple (lookupName a propertyNames) b
        let maxWidth = resolved <#> fst <#> Str.length # maximum
        for_ resolved \(Tuple pname ptype) -> do
            let indent = maybe 1 (\w -> w - Str.length pname + 1) maxWidth 
            rendered <- renderType ptype
            line $ pname <> ":" <> Str.times " " indent <> rendered <> ";"
    line "}"
