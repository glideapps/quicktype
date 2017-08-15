module Golang 
    ( renderer
    ) where

import Doc
import IRGraph
import Prelude

import Data.Array as A
import Data.Char.Unicode (isDigit, isLetter)
import Data.Foldable (for_, intercalate, foldl)
import Data.List (List, (:))
import Data.List as L
import Data.Map as M
import Data.Maybe (Maybe(..), isJust, maybe)
import Data.Set (Set)
import Data.Set as S
import Data.String as Str
import Data.String.Util (camelCase, stringEscape, legalizeCharacters, startWithLetter)
import Data.Tuple (Tuple(..), fst)
import Utils (mapM, removeElement, sortByKeyM, sortByKey)

renderer :: Renderer
renderer =
    { name: "Go"
    , aceMode: "golang"
    , extension: "go"
    , doc: golangDoc
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: []
        , topLevelName: forbidNamer goNameStyle (\n -> let gn = goNameStyle n in [gn, "Unmarshal" <> gn])
        , unions: Just
            { predicate: excludeNullablesUnionPredicate
            , properName: simpleNamer (goNameStyle <<< combineNames)
            , nameFromTypes: simpleNamer unionNameFromTypes
            }
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

unionNameFromTypes :: Array String -> String
unionNameFromTypes names =
    names
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

noComment :: String -> Doc { rendered :: String, comment :: Maybe String }
noComment rendered =
    pure { rendered, comment: Nothing }

renderNullableToGolang :: IRType -> Doc { rendered :: String, comment :: Maybe String }
renderNullableToGolang x = do
    { rendered, comment } <- renderTypeToGolang x
    pure
        if isValueType x then
            { rendered: "*" <> rendered, comment: Just $ maybe "optional" ("optional "<> _) comment }
        else
            { rendered, comment: Nothing }

renderUnionToGolang :: IRUnionRep -> Doc { rendered :: String, comment :: Maybe String }
renderUnionToGolang ur =
    case nullableFromSet $ unionToSet ur of
    Just x -> renderNullableToGolang x
    Nothing -> do
        noComment =<< lookupUnionName ur

renderTypeToGolang :: IRType -> Doc { rendered :: String, comment :: Maybe String }
renderTypeToGolang = case _ of
    IRNothing -> noComment "interface{}"
    IRNull -> noComment "interface{}"
    IRInteger -> noComment "int64"
    IRDouble -> noComment "float64"
    IRBool -> noComment "bool"
    IRString -> noComment "string"
    IRArray a -> do
        { rendered, comment } <- renderTypeToGolang a
        pure { rendered: "[]" <> rendered, comment: map ("array of " <> _) comment }
    IRClass i -> noComment =<< lookupClassName i
    IRMap t -> do
        { rendered, comment } <- renderTypeToGolang t
        pure { rendered: "map[string]" <> rendered, comment: map ("map to " <> _) comment }
    IRUnion types -> renderUnionToGolang types

renderComment :: Maybe String -> String
renderComment (Just s) = " /* " <> s <> " */"
renderComment Nothing = ""

goNameStyle :: String -> String
goNameStyle = legalizeCharacters isLetterCharacter >>> camelCase >>> startWithLetter isLetterCharacter true

golangDoc :: Doc Unit
golangDoc = do
    line "// To parse and unparse this JSON data, add this code to your project and do:"
    forTopLevel_ \topLevelName topLevelType -> do
        line "//"
        line $ "//    r, err := Unmarshal" <> topLevelName <> "(bytes)"
        line $ "//    bytes, err = r.Marshal()"
    blank
    line "package main"
    unions <- getUnions
    unless (unions == L.Nil) do
        line "import \"bytes\""
        line "import \"errors\""
    line "import \"encoding/json\""
    forTopLevel_ \topLevelName topLevelType -> do
        { rendered: renderedToplevel, comment: toplevelComment } <- renderTypeToGolang topLevelType
        blank
        line $ "type " <> topLevelName <> " " <> renderedToplevel <> (renderComment toplevelComment)
        blank
        line $ "func Unmarshal" <> topLevelName <> "(data []byte) (" <> topLevelName <> ", error) {"
        line $ "    var r " <> topLevelName
        line """    err := json.Unmarshal(data, &r)
    return r, err
}
"""
        line $ "func (r *" <> topLevelName <> ") Marshal() ([]byte, error) {"
        indent do
            line "return json.Marshal(r)"
        line "}"
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
}"""
    for_ unions \types -> do
        blank
        renderGolangUnion types

pad :: Int -> String -> String
pad n s = s <> Str.fromCharArray (A.replicate (n - (Str.length s)) ' ')

columnize :: List (List String) -> Doc Unit
columnize L.Nil = pure unit
columnize rows@(firstRow : otherRows) =
    let columnWidths = foldl (\m l -> L.zipWith max m $ map Str.length l) (map Str.length firstRow) otherRows
        paddedRows = map (L.zipWith pad columnWidths) rows
    in
        for_ paddedRows \row -> do
            line $ Str.trim $ intercalate " " row

renderStruct :: String -> List (List String) -> Doc Unit
renderStruct name columns = do
    line $ "type " <> name <> " struct {"
    indent do
        columnize columns
    line "}"

renderGolangType :: Int -> IRClassData -> Doc Unit
renderGolangType classIndex (IRClassData { names, properties }) = do
    className <- lookupClassName classIndex
    let { names: propertyNames } = transformNames (simpleNamer goNameStyle) ("Other" <> _) S.empty $ map (\n -> Tuple n n) $ M.keys properties
    let propsList = M.toUnfoldable properties # sortByKey (\t -> lookupName (fst t) propertyNames)
    columns <- propsList # mapM \(Tuple pname ptype) -> do
        let csPropName = lookupName pname propertyNames
        { rendered, comment } <- renderTypeToGolang ptype
        pure $ (csPropName : rendered : ("`json:\"" <> (stringEscape pname) <> "\"`" <> renderComment comment) : L.Nil)
    renderStruct className columns

unionFieldName :: IRType -> Doc String
unionFieldName t = goNameStyle <$> getTypeNameForUnion t

compoundPredicates :: Array (IRType -> Boolean)
compoundPredicates = [isArray, isClass, isMap]

renderGolangUnion :: IRUnionRep -> Doc Unit
renderGolangUnion ur = do
    name <- lookupUnionName ur
    let { element: emptyOrNull, rest: nonNullTypes } = removeElement (_ == IRNull) allTypes
    let isNullableString = if isJust emptyOrNull then "true" else "false"
    fields <- L.fromFoldable nonNullTypes # sortByKeyM unionFieldName
    columns <- fields # mapM \t -> do
        { rendered, comment } <- renderNullableToGolang t
        field <- unionFieldName t
        pure $ (field : (rendered <> renderComment comment) : L.Nil)
    renderStruct name columns
    blank
    line $ "func (x *" <> name <> ") UnmarshalJSON(data []byte) error {"    
    indent do
        for_ compoundPredicates \p -> maybeAssignNil p
        ifClass \_ typeString -> do
            line $ "var c " <> typeString
        args <- makeArgs primitiveUnmarshalArg compoundUnmarshalArg
        line $ "object, err := unmarshalUnion(data, " <> args <> ", " <> isNullableString <> ")"
        line "if err != nil {"
        indent do
    		line "return err"
        line "}"
        line "if object {"
        ifClass \name _ -> do
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
        allTypes = unionToSet ur
        ifClass :: (String -> String -> Doc Unit) -> Doc Unit
        ifClass f =
            let { element } = removeElement isClass allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    { rendered } <- renderTypeToGolang t
                    f name rendered
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
        memberArg :: String -> (IRType -> String -> String) -> (IRType -> Boolean) -> Doc String
        memberArg notPresentValue renderPresent p =
            let { element } = removeElement p allTypes
            in
                case element of
                Just t -> do
                    name <- unionFieldName t
                    pure $ renderPresent t name
                Nothing -> pure notPresentValue
        primitiveUnmarshalArg t =
            memberArg "nil" (\_ n -> "&x." <> n) (eq t)
        compoundUnmarshalArg p =
            memberArg "false, nil" (\t n -> if isClass t then "true, &c" else "true, &x." <> n) p
        primitiveMarshalArg :: IRType -> Doc String
        primitiveMarshalArg t =
            memberArg "nil" (\_ n -> "x." <> n) (eq t)
        compoundMarshalArg :: (IRType -> Boolean) -> Doc String
        compoundMarshalArg p =
            memberArg "false, nil" (\t n -> "x." <> n <> " != nil, x." <> n) p
