module Golang 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Array as A
import Data.Char.Unicode (isDigit, isLetter)
import Data.Foldable (for_, intercalate)
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Util (capitalize, camelCase, stringEscape)
import Data.Tuple (Tuple(..))
import Utils (mapM, removeElement)

renderer :: Renderer
renderer =
    { name: "Go"
    , aceMode: "golang"
    , extension: "go"
    , doc: golangDoc
    , transforms:
        { nameForClass
        , unionName
        , unionPredicate
        , nextName: \s -> "Other" <> s
        , forbiddenNames: []
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
nameForClass (IRClassData { names }) = goNameStyle $ combineNames names

unionName :: L.List String -> String
unionName s =
    L.sort s
    <#> goNameStyle
    # intercalate "Or"

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

renderUnionToGolang :: Set IRType -> Doc String
renderUnionToGolang s =
    case nullableFromSet s of
    Just x -> do
        rendered <- renderTypeToGolang x
        pure if isValueType x then "*" <> rendered else rendered
    Nothing -> lookupUnionName s

renderTypeToGolang :: IRType -> Doc String
renderTypeToGolang = case _ of
    IRNothing -> pure "interface{}"
    IRNull -> pure "interface{}"
    IRInteger -> pure "int64"
    IRDouble -> pure "float64"
    IRBool -> pure "bool"
    IRString -> pure "string"
    IRArray a -> do
        rendered <- renderTypeToGolang a
        pure $ "[]" <> rendered
    IRClass i -> lookupClassName i
    IRMap t -> do
        rendered <- renderTypeToGolang t
        pure $ "map[string]" <> rendered
    IRUnion types -> renderUnionToGolang $ unionToSet types

goNameStyle :: String -> String
goNameStyle = camelCase >>> capitalize >>> legalizeIdentifier

golangDoc :: Doc Unit
golangDoc = do
    line "package main"
    blank
    unions <- getUnions
    unless (unions == L.Nil) do
        line "import \"bytes\""
        line "import \"errors\""
        line "import \"encoding/json\""
        blank
    renderedToplevel <- getTopLevel >>= renderTypeToGolang
    line $ "type Root " <> renderedToplevel
    blank
    classes <- getClasses
    for_ classes \(Tuple i cls) -> do
        renderGolangType i cls
        blank
    unless (unions == L.Nil) do
        line """func unmarshalUnion(data []byte, pi **int64, pf **float64, pb **bool, ps **string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, nullable bool) (bool, error) {
	if pi != nil {
		*pi = nil
	}
	if pf != nil {
		*pf = nil
	}
	if pb != nil {
		*pb = nil
	}
	if ps != nil {
		*ps = nil
	}

	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return false, err
	}

	switch v := tok.(type) {
	case json.Number:
		if pi != nil {
			i, err := v.Int64()
			if err == nil {
				*pi = &i
				return false, nil
			}
		}
		if pf != nil {
			f, err := v.Float64()
			if err == nil {
				*pf = &f
				return false, nil
			}
			return false, errors.New("Unparsable number")
		}
		return false, errors.New("Union does not contain number")
	case float64:
		return false, errors.New("Decoder should not return float64")
	case bool:
		if pb != nil {
			*pb = &v
			return false, nil
		}
		return false, errors.New("Union does not contain bool")
	case string:
		if ps != nil {
			*ps = &v
			return false, nil
		}
		return false, errors.New("Union does not contain string")
	case nil:
		if nullable {
			return false, nil
		}
		return false, errors.New("Union does not contain null")
	case json.Delim:
		if v == '{' {
			if haveObject {
				return true, json.Unmarshal(data, pc)
			}
			if haveMap {
				return false, json.Unmarshal(data, pm)
			}
			return false, errors.New("Union does not contain object")
		}
		if v == '[' {
			if haveArray {
				return false, json.Unmarshal(data, pa)
			}
			return false, errors.New("Union does not contain array")
		}
		return false, errors.New("Cannot handle delimiter")
	}
	return false, errors.New("Cannot unmarshal union")

}

func marshalUnion(pi *int64, pf *float64, pb *bool, ps *string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, nullable bool) ([]byte, error) {
	if pi != nil {
		return json.Marshal(*pi)
	}
	if pf != nil {
		return json.Marshal(*pf)
	}
	if pb != nil {
		return json.Marshal(*pb)
	}
	if ps != nil {
		return json.Marshal(*ps)
	}
	if haveArray {
		return json.Marshal(pa)
	}
	if haveObject {
		return json.Marshal(pc)
	}
	if haveMap {
		return json.Marshal(pm)
	}
	if nullable {
		return json.Marshal(nil)
	}
	return nil, errors.New("Union must not be null")
}
"""
    for_ unions \types -> do
        renderGolangUnion types
        blank

renderGolangType :: Int -> IRClassData -> Doc Unit
renderGolangType classIndex (IRClassData { names, properties }) = do
    className <- lookupClassName classIndex
    let propertyNames = transformNames goNameStyle ("Other" <> _) S.empty $ map (\n -> Tuple n n) $ Map.keys properties
    line $ "type " <> className <> " struct {"
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            let csPropName = lookupName pname propertyNames
            rendered <- renderTypeToGolang ptype
            line $ csPropName <> " " <> rendered <> " `json:\"" <> (stringEscape pname) <> "\"`"
    line "}"

unionFieldName :: IRType -> Doc String
unionFieldName t = goNameStyle <$> getTypeNameForUnion t

compoundPredicates :: Array (IRType -> Boolean)
compoundPredicates = [isArray, isClass, isMap]

renderGolangUnion :: Set IRType -> Doc Unit
renderGolangUnion allTypes = do
    name <- lookupUnionName allTypes
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) allTypes
    let isNullableString = if isJust emptyOrNull then "true" else "false"
    line $ "type " <> name <> " struct {"
    indent do
        for_ nonNullTypes \t -> do
            typeString <- renderUnionToGolang $ S.union (S.singleton t) (S.singleton IRNull)
            field <- unionFieldName t
            line $ field <> " " <> typeString
    line "}"
    blank
    line $ "func (x *" <> name <> ") UnmarshalJSON(data []byte) error {"    
    indent do
        for_ compoundPredicates \p -> maybeAssignNil p
        ifClass \name -> do
            line $ "var c " <> name
        args <- makeArgs primitiveUnmarshalArg compoundUnmarshalArg
        line $ "object, err := unmarshalUnion(data, " <> args <> ", " <> isNullableString <> ")"
        line "if err != nil {"
        indent do
    		line "return err"
        line "}"
        line "if object {"
        ifClass \name -> do
            indent do
                line $ "x." <> name <> " = &c"
        line "}"
        line "return nil"
    line "}"
    blank
    line $ "func (x *" <> name <> ") MarshalJSON() ([]byte, error) {"
    indent do
        args <- makeArgs primitiveMarshalArg compoundMarshalArg
        line $ "return marshalUnion(" <> args <> ", " <> isNullableString <> ")"
    line "}"
    where
        ifClass :: (String -> Doc Unit) -> Doc Unit
        ifClass f =
            let { element } = removeElement isClass allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    f name
                Nothing -> pure unit
        maybeAssignNil p =
            let { element } = removeElement p allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    line $ "x." <> name <> " = nil"
                Nothing -> pure unit
        makeArgs :: (IRType -> Doc String) -> ((IRType -> Boolean) -> Doc String) -> Doc String
        makeArgs primitive compound = do
            primitiveArgs <- mapM primitive $ L.fromFoldable [IRInteger, IRDouble, IRBool, IRString]
            compoundArgs <- mapM compound $ L.fromFoldable compoundPredicates
            pure $ intercalate ", " $ A.concat [A.fromFoldable primitiveArgs, A.fromFoldable compoundArgs]
        memberArg :: String -> (String -> String) -> (IRType -> Boolean) -> Doc String
        memberArg notPresentValue renderPresent p =
            let { element } = removeElement p allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    pure $ renderPresent name
                Nothing -> pure notPresentValue
        primitiveUnmarshalArg t =
            memberArg "nil" ("&x." <> _) (eq t)
        compoundUnmarshalArg p =
            memberArg "false, nil" ("true, &x." <> _) p
        primitiveMarshalArg :: IRType -> Doc String
        primitiveMarshalArg t =
            memberArg "nil" ("x." <> _) (eq t)
        compoundMarshalArg :: (IRType -> Boolean) -> Doc String
        compoundMarshalArg p =
            memberArg "false, nil" (\n -> "x." <> n <> " != nil, x." <> n) p
