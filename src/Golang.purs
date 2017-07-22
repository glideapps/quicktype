module Golang 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isDigit, isLetter)
import Data.Foldable (for_, intercalate)
import Data.List (List, fromFoldable, (:))
import Data.List as L
import Data.Map (keys, lookup)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromJust, fromMaybe)
import Data.Set (empty)
import Data.Set as Set
import Data.String (toCharArray)
import Data.String as Str
import Data.String.Util (capitalize, camelCase)
import Data.String.Utils (mapChars)
import Data.Tuple (Tuple(..))

renderer :: Renderer
renderer =
    { name: "Go"
    , aceMode: "golang"
    , extension: "go"
    , doc: golangDoc
    }

isValueType :: IRType -> Boolean
isValueType IRInteger = true
isValueType IRDouble = true
isValueType IRBool = true
isValueType IRString = true
isValueType (IRClass _) = true
isValueType _ = false

isLetterCharacter :: Char -> Boolean
isLetterCharacter c =
    isLetter c || c == '_'

isStartCharacter :: Char -> Boolean
isStartCharacter = isLetterCharacter

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    isLetterCharacter c || isDigit c

legalizeIdentifier :: String -> String
legalizeIdentifier str =
    case Str.charAt 0 str of
    -- FIXME: use the type to infer a name?
    Nothing -> "Empty"
    Just s ->
        if isStartCharacter s then
            Str.fromCharArray $ map (\c -> if isLetterCharacter c then c else '_') $ Str.toCharArray str
        else
            legalizeIdentifier ("_" <> str)

nullableFromSet :: Set.Set IRType -> Maybe IRType
nullableFromSet s =
    case L.fromFoldable s of
    IRNull : x : L.Nil -> Just x
    x : IRNull : L.Nil -> Just x
    _ -> Nothing

renderUnionToGolang :: (Map.Map Int String) -> IRGraph -> Set.Set IRType -> String
renderUnionToGolang classNames graph s =
    case nullableFromSet s of
    Just x -> if isValueType x then "*" <> renderTypeToGolang classNames graph x else renderTypeToGolang classNames graph x
    Nothing -> "interface{}" -- FIXME: implement!

lookupName :: forall a. Ord a => a -> (Map.Map a String) -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ Map.lookup original nameMap

renderTypeToGolang :: (Map.Map Int String) -> IRGraph -> IRType -> String
renderTypeToGolang classNames graph = case _ of
    IRNothing -> "interface{}"
    IRNull -> "interface{}"
    IRInteger -> "int64"
    IRDouble -> "float64"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> "[]" <> renderTypeToGolang classNames graph a
    IRClass i -> lookupName i classNames
    IRMap t -> "map[string]" <> renderTypeToGolang classNames graph t
    IRUnion types -> renderUnionToGolang classNames graph types

goNameStyle :: String -> String
goNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

golangDoc :: Doc Unit
golangDoc = do
    lines "import \"encoding/json\""
    blank
    classes <- getClasses
    let names = transformNames (\(IRClassData { names }) -> goNameStyle $ combineNames names) ("Other" <> _) Set.empty classes
    graph@IRGraph { toplevel } <- getGraph
    words ["// toplevel is ", renderTypeToGolang names graph toplevel]
    blank
    blank
    for_ classes \(Tuple i cls) -> do
        renderGolangType names i cls
        blank

renderGolangType :: (Map.Map Int String) -> Int -> IRClassData -> Doc Unit
renderGolangType classNames classIndex (IRClassData { names, properties }) = do
    let className = lookupName classIndex classNames
    let propertyNames = transformNames goNameStyle ("Other" <> _) Set.empty $ map (\n -> Tuple n n) $ Map.keys properties
    line $ words ["type", className, "struct {"]
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            line do
                let csPropName = lookupName pname propertyNames
                graph <- getGraph
                string $ csPropName <> " " <> renderTypeToGolang classNames graph ptype <> " `json:\"" <> pname <> "\"`"
    lines "}"
