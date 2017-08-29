module Language.SimpleTypes 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Bifunctor (bimap)
import Data.Char.Unicode (GeneralCategory(..), generalCategory)
import Data.Foldable (for_, intercalate, maximum)
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(Nothing, Just), maybe)
import Data.Set (Set)
import Data.String as Str
import Data.String.Util as Str
import Data.Tuple (Tuple(..), fst)
import Utils (mapM)

renderer :: Renderer
renderer =
    { name: "Simple Types"
    , aceMode: "groovy"
    , extension: "types"
    , doc: pseudocodeDoc
    , transforms:
        { nameForClass: noForbidNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: []
        , topLevelName: simpleNamer id
        , unions: Nothing
        }
    }

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = upperNameStyle $ combineNames names

isComplex :: IRType -> Boolean
isComplex = case _ of
    IRArray a -> isComplex a    
    IRMap _ -> true
    IRUnion _ -> true
    _ -> false

isStartCharacter :: Char -> Boolean
isStartCharacter c = Str.isLetterOrLetterNumber c || c == '_'

isPartCharacter :: Char -> Boolean
isPartCharacter c =
    case generalCategory c of
    Just DecimalNumber -> true
    Just ConnectorPunctuation -> true
    Just NonSpacingMark -> true
    Just SpacingCombiningMark -> true
    Just Format -> true
    _ -> isStartCharacter c

renderUnion :: Set IRType -> Doc String
renderUnion s =
    case nullableFromSet s of
    Just x -> renderType x
    Nothing -> do
        types <- mapM renderType $ L.fromFoldable s
        pure $ intercalate " | " types

renderType :: IRType -> Doc String
renderType = case _ of
    IRNothing -> pure "Any" -- we can have arrays of nothing
    IRNull -> pure "Null"
    IRInteger -> pure "Integer"
    IRDouble -> pure "Double"
    IRBool -> pure "Boolean"
    IRString -> pure "String"
    IRClass i -> lookupClassName i

    IRArray a | isComplex a -> do
        rendered <- renderType a
        pure $ "Array<" <> rendered <> ">"

    IRArray a -> do
        rendered <- renderType a
        pure $ rendered <> "[]"

    IRMap t -> do
        rendered <- renderType t
        pure $ "Map<String, " <> rendered <> ">"

    IRUnion types -> do
        let typeSet = unionToSet types
        case nullableFromSet typeSet of
            Nothing -> renderUnion typeSet
            Just t -> do
                rendered <- renderType t
                pure $ "Maybe<" <> rendered <> ">"

legalize :: String -> String
legalize = Str.legalizeCharacters isPartCharacter

classNameStyle :: Boolean -> String -> String
classNameStyle upper = legalize >>> Str.camelCase >>> (Str.startWithLetter isStartCharacter upper)

upperNameStyle :: String -> String
upperNameStyle = classNameStyle true

propertyNameify :: String -> String
propertyNameify = case _ of
    "" -> "\"\""
    s | Str.contains (Str.Pattern " ") s -> "\"" <> s <> "\""
    s -> s

renderClass :: String -> Map String IRType -> Doc Unit
renderClass className properties = do
    line $ "class " <> className <> " {"
    indent do
        let props = M.toUnfoldable properties :: Array _
        let propsClean = bimap propertyNameify id <$> props
        let maxWidth = propsClean <#> fst <#> Str.length # maximum
        for_ propsClean \(Tuple pname ptype) -> do
            let indent = maybe 1 (\w -> w - Str.length pname + 1) maxWidth 
            rendered <- renderType ptype
            line $ pname <> ":" <> Str.times " " indent <> rendered
    line "}"

pseudocodeDoc :: Doc Unit
pseudocodeDoc = renderRenderItems blank Nothing renderClass Nothing
