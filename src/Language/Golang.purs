module Language.Golang 
    ( renderer
    ) where

import Prelude

import Data.Array as A
import Data.Foldable (for_, intercalate, foldl)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), maybe)
import Data.String as Str
import Data.String.Util (camelCase, stringEscape, legalizeCharacters, isLetterOrUnderscore, isLetterOrUnderscoreOrDigit, startWithLetter)
import Data.Tuple (Tuple(..), fst)
import Doc (Doc, Renderer, blank, combineNames, forEachTopLevel_, forbidNamer, getTypeNameForUnion, getUnions, indent, line, lookupClassName, lookupName, lookupUnionName, renderRenderItems, simpleNamer, transformPropertyNames, unionIsNotSimpleNullable)
import IRGraph (IRClassData(..), IRType(..), IRUnionRep, isClass, isUnionMember, nullableFromUnion, removeNullFromUnion, unionHasArray, unionHasClass, unionHasMap, unionToList)
import Utils (mapM, sortByKeyM, sortByKey)

renderer :: Renderer
renderer =
    { displayName: "Go"
    , names: [ "go", "golang" ]
    , aceMode: "golang"
    , extension: "go"
    , doc: golangDoc
    , options: []
    , transforms:
        { nameForClass: simpleNamer nameForClass
        , nextName: \s -> "Other" <> s
        , forbiddenNames: []
        , topLevelName: forbidNamer goNameStyle (\n -> let gn = goNameStyle n in [gn, "Unmarshal" <> gn])
        , unions: Just
            { predicate: unionIsNotSimpleNullable
            , properName: simpleNamer (goNameStyle <<< combineNames)
            , nameFromTypes: simpleNamer unionNameFromTypes
            }
        }
    }

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
    case nullableFromUnion ur of
    Just x -> renderNullableToGolang x
    Nothing -> do
        noComment =<< lookupUnionName ur

renderTypeToGolang :: IRType -> Doc { rendered :: String, comment :: Maybe String }
renderTypeToGolang = case _ of
    IRNoInformation -> noComment "FIXME_THIS_SHOULD_NOT_HAPPEN"
    IRAnyType -> noComment "interface{}"
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

legalize :: String -> String
legalize = legalizeCharacters isLetterOrUnderscoreOrDigit

goNameStyle :: String -> String
goNameStyle = legalize >>> camelCase >>> startWithLetter isLetterOrUnderscore true

golangDoc :: Doc Unit
golangDoc = do
    line "// To parse and unparse this JSON data, add this code to your project and do:"
    forEachTopLevel_ \topLevelName topLevelType -> do
        line "//"
        line $ "//    r, err := Unmarshal" <> topLevelName <> "(bytes)"
        line $ "//    bytes, err = r.Marshal()"
    blank
    line "package main"
    blank
    unions <- getUnions
    unless (unions == L.Nil) do
        line "import \"bytes\""
        line "import \"errors\""
    line "import \"encoding/json\""
    blank
    renderRenderItems blank (Just renderTopLevel) renderGolangType (Just renderGolangUnion)
    unless (unions == L.Nil) do
        blank
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

renderTopLevel :: String -> IRType -> Doc Unit
renderTopLevel topLevelName topLevelType = do
    { rendered: renderedToplevel, comment: toplevelComment } <- renderTypeToGolang topLevelType
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

renderGolangType :: String -> Map String IRType -> Doc Unit
renderGolangType className properties = do
    let propertyNames = transformPropertyNames (simpleNamer goNameStyle) ("Other" <> _) [] properties
    let propsList = M.toUnfoldable properties # sortByKey (\t -> lookupName (fst t) propertyNames)
    columns <- propsList # mapM \(Tuple pname ptype) -> do
        let csPropName = lookupName pname propertyNames
        { rendered, comment } <- renderTypeToGolang ptype
        pure $ (csPropName : rendered : ("`json:\"" <> (stringEscape pname) <> "\"`" <> renderComment comment) : L.Nil)
    renderStruct className columns

unionFieldName :: IRType -> Doc String
unionFieldName t = goNameStyle <$> getTypeNameForUnion t

compoundPredicates :: Array (IRUnionRep -> Maybe IRType)
compoundPredicates = [unionHasArray, unionHasClass, unionHasMap]

renderGolangUnion :: String -> IRUnionRep -> Doc Unit
renderGolangUnion name unionRep = do
    let { hasNull, nonNullUnion } = removeNullFromUnion unionRep
    let isNullableString = if hasNull then "true" else "false"
    fields <- unionToList nonNullUnion # sortByKeyM unionFieldName
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
        ifClass \name' _ -> do
            indent do
                line $ "x." <> name' <> " = &c"
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
        ifClass :: (String -> String -> Doc Unit) -> Doc Unit
        ifClass f =
            let element = unionHasClass unionRep
            in
                case element of
                Just t -> do
                    name' <- unionFieldName t
                    { rendered } <- renderTypeToGolang t
                    f name' rendered
                Nothing -> pure unit
        maybeAssignNil p =
            case p unionRep of
            Just t -> do
                name' <- unionFieldName t
                line $ "x." <> name' <> " = nil"
            Nothing -> pure unit
        predicateForType :: IRType -> IRUnionRep -> Maybe IRType
        predicateForType t ur =
            if isUnionMember t ur then Just t else Nothing
        makeArgs :: ((IRUnionRep -> Maybe IRType) -> Doc String) -> ((IRUnionRep -> Maybe IRType) -> Doc String) -> Doc String
        makeArgs primitive compound = do
            primitiveArgs <- mapM primitive $ map predicateForType [IRInteger, IRDouble, IRBool, IRString]
            compoundArgs <- mapM compound compoundPredicates
            pure $ intercalate ", " $ A.concat [primitiveArgs, compoundArgs]
        memberArg :: String -> (IRType -> String -> String) -> (IRUnionRep -> Maybe IRType) -> Doc String
        memberArg notPresentValue renderPresent p =
            case p unionRep of
            Just t -> do
                name' <- unionFieldName t
                pure $ renderPresent t name'
            Nothing -> pure notPresentValue
        primitiveUnmarshalArg p =
            memberArg "nil" (\_ n -> "&x." <> n) p
        compoundUnmarshalArg p =
            memberArg "false, nil" (\t n -> if isClass t then "true, &c" else "true, &x." <> n) p
        primitiveMarshalArg :: (IRUnionRep -> Maybe IRType) -> Doc String
        primitiveMarshalArg p =
            memberArg "nil" (\_ n -> "x." <> n) p
        compoundMarshalArg :: (IRUnionRep -> Maybe IRType) -> Doc String
        compoundMarshalArg p =
            memberArg "false, nil" (\t n -> "x." <> n <> " != nil, x." <> n) p
