module Language.Swift
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Char.Unicode (isAlphaNum, isDigit)
import Data.Foldable (for_, intercalate)
import Data.Function (on)
import Data.List as L
import Data.List.NonEmpty as NE
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.String.Util (camelCase, legalizeCharacters, startWithLetter)
import Data.Tuple (Tuple(..))
import Utils (removeElement)

renderer :: Renderer
renderer =
    { name: "Swift"
    , aceMode: "swift"
    , extension: "swift"
    , doc: swiftDoc
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: []
        , topLevelName: noForbidNamer (swiftNameStyle true)
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (swiftNameStyle true <<< combineNames)
            , nameFromTypes: simpleNamer (unionNameIntercalated (swiftNameStyle true) "Or")
            }
        }
    }

isStartCharacter :: Char -> Boolean
isStartCharacter c = c == '_' || (isAlphaNum c && not (isDigit c))

isPartCharacter :: Char -> Boolean
isPartCharacter c = c == '_' || isAlphaNum c

swiftNameStyle :: Boolean -> String -> String
swiftNameStyle isUpper = legalizeCharacters isPartCharacter >>> camelCase >>> startWithLetter isStartCharacter isUpper

nameForClass :: IRClassData -> String
nameForClass (IRClassData { names }) = swiftNameStyle true $ combineNames names

swiftDoc :: Doc Unit
swiftDoc = do
    line "import Foundation"
    forEachClass_ \className properties -> do
        blank
        renderClassDefinition className properties
    forEachUnion_ \unionName unionTypes -> do
        blank
        renderUnionDefinition unionName unionTypes

renderUnion :: IRUnionRep -> Doc String
renderUnion ur =
    case nullableFromSet $ unionToSet ur of
    Just r -> do
        rendered <- renderType r
        pure $ rendered <> "?"
    Nothing -> lookupUnionName ur

renderType :: IRType -> Doc String
renderType = case _ of
    IRNothing -> pure "Any?"
    IRNull -> pure "Any?"
    IRInteger -> pure "Int"
    IRDouble -> pure "Double"
    IRBool -> pure "Bool"
    IRString -> pure "String"
    IRArray a -> do
        rendered <- renderType a
        pure $ "[" <> rendered <> "]"
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderType t
        pure $ "[String: " <> rendered <> "]"
    IRUnion ur -> renderUnion ur

renderClassDefinition :: String -> Map String IRType -> Doc Unit
renderClassDefinition className properties = do
    line $ "struct " <> className <> " {"
    indent do
        let props = properties # M.toUnfoldable <#> \(Tuple name typ) -> { name, typ }
        let propGroups = L.groupBy (eq `on` _.typ) props
        for_ propGroups renderPropGroup
    line "}"

renderPropGroup :: NE.NonEmptyList { name :: String, typ :: IRType} -> Doc Unit
renderPropGroup props = do
    let names = intercalate ", " (_.name <$> props)
    let { typ } = NE.head props
    rendered <- renderType typ
    line $ "let " <> names <> ": " <> rendered

caseName :: IRType -> Doc String
caseName = case _ of
    IRArray a -> do
        rendered <- renderType a
        pure $ "some" <> rendered <> "s"
    IRNull -> pure "none"
    t -> do
        rendered <- renderType t
        pure $ "some" <> rendered

renderUnionDefinition :: String -> Set IRType -> Doc Unit
renderUnionDefinition unionName unionTypes = do
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) unionTypes
    line $ "enum " <> unionName <> " {"
    indent do
        for_ nonNullTypes \typ -> do
            name <- caseName typ
            rendered <- renderType typ
            line $ "case " <> name <> "(" <> rendered <> ")"
        case emptyOrNull of
            Just t -> do
                name <- caseName t
                line $ "case " <> name                
            Nothing -> pure unit
    line "}"
