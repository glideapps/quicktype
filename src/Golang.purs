module Golang 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude
import Types

import Data.Array as A
import Data.Char.Unicode (isDigit, isLetter)
import Data.Foldable (for_, intercalate)
import Data.FoldableWithIndex (allWithIndex)
import Data.Functor (map)
import Data.List (fromFoldable, (:))
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Set (Set, isEmpty, member, singleton, union)
import Data.Set as S
import Data.String as Str
import Data.String.Util (capitalize, camelCase, stringEscape)
import Data.Tuple (Tuple(..))
import Utils (mapM, removeElement)

-- data GoInfo = GoInfo { classNames ::  Map Int String }

type GoDoc = Doc Unit

renderer :: Renderer
renderer =
    { name: "Go"
    , aceMode: "golang"
    , extension: "go"
    , render: renderGraphToGolang
    }

renderGraphToGolang :: IRGraph -> String
renderGraphToGolang graph =
    runDoc golangDoc nameForClass unionName unionPredicate nextNameToTry S.empty graph unit
    where
        unionPredicate =
            case _ of
            IRUnion ur ->
                let s = unionToSet ur
                in
                    if isNothing $ nullableFromSet s then
                        Just s
                    else
                        Nothing
            _ -> Nothing
        nameForClass (IRClassData { names }) = goNameStyle $ combineNames names
        unionName components =
            "OneOf" <> (goNameStyle $ intercalate "_" $ components)
        nextNameToTry s =
            "Other" <> s

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

renderUnionToGolang :: Set IRType -> GoDoc String
renderUnionToGolang s =
    case nullableFromSet s of
    Just x -> do
        rendered <- renderTypeToGolang x
        pure if isValueType x then "*" <> rendered else rendered
    Nothing -> lookupUnionName s

renderTypeToGolang :: IRType -> GoDoc String
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

golangDoc :: GoDoc Unit
golangDoc = do
    lines "package main"
    blank
    unions <- getUnions
    unless (unions == L.Nil) do
        indent do
            lines "import \"bytes\""
            lines "import \"fmt\""
            lines "import \"errors\""
            lines "import \"encoding/json\""
            blank
    IRGraph { toplevel } <- getGraph
    renderedToplevel <- renderTypeToGolang toplevel
    lines $ "type Root " <> renderedToplevel
    blank
    classes <- getClasses
    for_ classes \(Tuple i cls) -> do
        renderGolangType i cls
        blank
    unless (unions == L.Nil) do
        lines """func unmarshalUnion(data []byte, pi **int64, pf **float64, pb **bool, ps **string, pa interface{}, pc interface{}, pm interface{}, nullable bool) error {
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

	fmt.Printf("union: %s\n", string(data))

	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return err
	}

	switch v := tok.(type) {
	case json.Number:
		if pi != nil {
			i, err := v.Int64()
			if err == nil {
				*pi = &i
				return nil
			}
		}
		if pf != nil {
			f, err := v.Float64()
			if err == nil {
				*pf = &f
				return nil
			}
			return errors.New("Unparsable number")
		}
		return errors.New("Union does not contain number")
	case float64:
		return errors.New("Decoder should not return float64")
	case bool:
		if pb != nil {
			*pb = &v
			return nil
		}
		return errors.New("Union does not contain bool")
	case string:
		if ps != nil {
			*ps = &v
			return nil
		}
		return errors.New("Union does not contain string")
	case nil:
		if nullable {
			return nil
		}
		return errors.New("Union does not contain null")
	case json.Delim:
		if v == '{' {
			if pc != nil {
				return json.Unmarshal(data, pc)
			}
			if pm != nil {
				return json.Unmarshal(data, pm)
			}
			return errors.New("Union does not contain object")
		}
		if v == '[' {
			if pa != nil {
				return json.Unmarshal(data, pa)
			}
			return errors.New("Union does not contain array")
		}
		return errors.New("Cannot handle delimiter")
	}
	return errors.New("Cannot unmarshal union")

}"""
        blank
    for_ unions \types -> do
        renderGolangUnion types
        blank

renderGolangType :: Int -> IRClassData -> GoDoc Unit
renderGolangType classIndex (IRClassData { names, properties }) = do
    className <- lookupClassName classIndex
    let propertyNames = transformNames goNameStyle ("Other" <> _) S.empty $ map (\n -> Tuple n n) $ Map.keys properties
    line $ words ["type", className, "struct {"]
    indent do
        for_ (Map.toUnfoldable properties :: Array _) \(Tuple pname ptype) -> do
            let csPropName = lookupName pname propertyNames
            rendered <- renderTypeToGolang ptype
            lines $ csPropName <> " " <> rendered <> " `json:\"" <> (stringEscape pname) <> "\"`"
    lines "}"

unionFieldName :: IRType -> GoDoc String
unionFieldName t = do
    graph <- getGraph
    let typeName = typeNameForUnion graph t
    pure $ goNameStyle typeName

compoundPredicates :: Array (IRType -> Boolean)
compoundPredicates = [isArray, isClass, isMap]

renderGolangUnion :: Set IRType -> GoDoc Unit
renderGolangUnion allTypes = do
    name <- lookupUnionName allTypes
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) allTypes
    line $ words ["type", name, "struct {"]
    indent do
        for_ nonNullTypes \t -> do
            typeString <- renderUnionToGolang $ S.union (S.singleton t) (S.singleton IRNull)
            field <- unionFieldName t
            lines $ field <> " " <> typeString
    lines "}"
    blank
    lines $ "func (x *" <> name <> ") UnmarshalJSON(data []byte) error {"
    primitiveArgs <- mapM primitiveMemberPtr $ L.fromFoldable [IRInteger, IRDouble, IRBool, IRString]
    compoundArgs <- mapM memberPtr $ L.fromFoldable compoundPredicates
    let args = intercalate ", " $ A.concat [A.fromFoldable primitiveArgs, A.fromFoldable compoundArgs]
    indent do
        for_ compoundPredicates \p -> maybeAssignNil p
        lines $ "\treturn unmarshalUnion(data, " <> args <> ", " <> (if isJust emptyOrNull then "true" else "false") <> ")"
    lines "}"
    where
        maybeAssignNil p =
            let { element } = removeElement p allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    lines $ "x." <> name <> " = nil"
                Nothing -> pure unit
        memberPtr p =
            let { element } = removeElement p allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    pure $ "&x." <> name
                Nothing -> pure "nil"
        primitiveMemberPtr t =
            memberPtr (eq t)
