module TypeScript 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter)
import Data.Foldable (for_, intercalate, maximum, maximumBy)
import Data.Function (on)
import Data.List (fromFoldable)
import Data.List as L
import Data.Map (keys)
import Data.Map as M
import Data.Maybe (Maybe(Nothing, Just), fromMaybe, maybe)
import Data.Set (Set)
import Data.Set as S
import Data.String (Pattern(..), contains, length)
import Data.String as Str
import Data.String.Util as Str
import Data.Tuple (Tuple(..), fst)
import Utils (mapM)

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
        , nextName: \s -> "other_" <> s
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
    IRNothing -> pure "object" -- we can have arrays of nothing
    IRNull -> pure "object"
    IRInteger -> pure "long"
    IRDouble -> pure "double"
    IRBool -> pure "bool"
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
    | Str.contains (Str.Pattern " ") s = "\"" <> s <> "\""
    | otherwise = s

typeScriptDoc :: Doc Unit
typeScriptDoc = do
    top <- getTopLevel >>= renderType
    line $ """// To parse this JSON data:
//
//     let result: """ <> top <> """ = JSON.parse(json);
//
"""       
    classes <- getClasses
    for_ classes \(Tuple i cd) -> do
        interface <- lookupClassName i
        renderInterface cd interface
        blank

renderInterface :: IRClassData -> String -> Doc Unit
renderInterface (IRClassData { names, properties }) className = do
    let propertyNames = transformNames propertyNamify ("other " <> _) (S.singleton className) $ map (\n -> Tuple n n) $ M.keys properties
    line $ "interface " <> className <> " {"
    indent do
        let props = M.toUnfoldable properties :: Array _
        let resolved = props <#> \(Tuple a b) -> Tuple (lookupName a propertyNames) b
        let maxWidth = props <#> fst <#> Str.length # maximum
        for_ props \(Tuple pname ptype) -> do
            let indent = maybe 1 (\w -> w - Str.length pname + 1) maxWidth 
            rendered <- renderType ptype
            line $ pname <> ":" <> Str.times " " indent <> rendered <> ";"
    line "}"
