module Language.SimpleTypes 
    ( renderer
    ) where

import Doc (Doc, Renderer, blank, combineNames, indent, line, lookupClassName, noForbidNamer, renderRenderItems, simpleNamer)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, mapUnionM, nullableFromUnion)
import Prelude

import Data.Bifunctor (bimap)
import Data.Char.Unicode (GeneralCategory(..), generalCategory)
import Data.Foldable (for_, intercalate, maximum)
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(Nothing, Just), maybe)
import Data.String (Pattern(Pattern), contains, length) as Str
import Data.String.Util (camelCase, isLetterOrLetterNumber, legalizeCharacters, startWithLetter, times) as Str
import Data.Tuple (Tuple(..), fst)

renderer :: Renderer
renderer =
    { name: "Simple Types"
    , aceMode: "groovy"
    , extension: "types"
    , doc: pseudocodeDoc
    , options: []
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

renderUnion :: IRUnionRep -> Doc String
renderUnion ur =
    case nullableFromUnion ur of
    Just x -> renderType x
    Nothing -> do
        types <- mapUnionM renderType ur
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

    IRUnion ur ->
        case nullableFromUnion ur of
            Nothing -> renderUnion ur
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
        let props = M.toUnfoldable properties :: Array (Tuple String IRType)
        let propsClean = bimap propertyNameify id <$> props
        let maxWidth = propsClean <#> fst <#> Str.length # maximum
        for_ propsClean \(Tuple pname ptype) -> do
            let indent = maybe 1 (\w -> w - Str.length pname + 1) maxWidth 
            rendered <- renderType ptype
            line $ pname <> ":" <> Str.times " " indent <> rendered
    line "}"

pseudocodeDoc :: Doc Unit
pseudocodeDoc = renderRenderItems blank Nothing renderClass Nothing
