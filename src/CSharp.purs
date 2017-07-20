module CSharp 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types

import Data.Char.Unicode (GeneralCategory(..), generalCategory, isLetter)
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
    { name: "C#"
    , aceMode: "csharp"
    , doc: csharpDoc
    }

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

renderUnionToCSharp :: (Map.Map Int String) -> IRGraph -> Set.Set IRType -> String
renderUnionToCSharp classNames graph s =
    case nullableFromSet s of
    Just x -> if isValueType x then renderTypeToCSharp classNames graph x <> "?" else renderTypeToCSharp classNames graph x
    Nothing -> "Either<" <> intercalate ", " (map (renderTypeToCSharp classNames graph) (L.fromFoldable s)) <> ">"

lookupName :: forall a. Ord a => a -> (Map.Map a String) -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ Map.lookup original nameMap

renderTypeToCSharp :: (Map.Map Int String) -> IRGraph -> IRType -> String
renderTypeToCSharp classNames graph = case _ of
    IRNothing -> "object"
    IRNull -> "object"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> renderTypeToCSharp classNames graph a <> "[]"
    IRClass i -> lookupName i classNames
    IRMap t -> "Dictionary<string, " <> renderTypeToCSharp classNames graph t <> ">"
    IRUnion types -> renderUnionToCSharp classNames graph types

csNameStyle :: String -> String
csNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

csharpDoc :: Doc Unit
csharpDoc = do
    lines """namespace QuickType
             {"""
    blank
    indent do
        lines """using System.Net;
                 using System.Collections.Generic;
                 using Newtonsoft.Json;"""
        blank
        classes <- getClasses
        let names = transformNames (\(IRClassData { names }) -> csNameStyle $ combineNames names) ("Other" <> _) Set.empty classes
        for_ classes \(Tuple i cls) -> do
            renderCSharpClass names i cls
            blank
    lines "}"

renderCSharpClass :: (Map.Map Int String) -> Int -> IRClassData -> Doc Unit
renderCSharpClass classNames classIndex (IRClassData { names, properties }) = do
    let className = lookupName classIndex classNames
    let propertyNames = transformNames csNameStyle ("Other" <> _) (Set.singleton className) $ map (\n -> Tuple n n) $ Map.keys properties
    line $ words ["class", className]

    lines "{"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            line do
                string "[JsonProperty(\""
                string pname
                string "\")]"
            line do
                string "public "
                graph <- getGraph
                string $ renderTypeToCSharp classNames graph ptype
                let csPropName = lookupName pname propertyNames
                words ["", csPropName, "{ get; set; }"]
            blank
        
        -- TODO don't rely on 'TopLevel'
        when (names == Set.singleton "TopLevel") do
            lines """// Loading helpers
                     public static TopLevel FromJson(string json) => JsonConvert.DeserializeObject<TopLevel>(json);"""
    lines "}"
