port module Main exposing (main)

import Json.Decode exposing (decodeString, errorToString)
import QuickType


port fromJS : (String -> msg) -> Sub msg


port toJS : String -> Cmd msg


type Msg
    = FromJS String


update : Msg -> () -> ( (), Cmd Msg )
update msg _ =
    case msg of
        FromJS str ->
            case decodeString QuickType.quickType str of
                Ok r ->
                    ( (), toJS (QuickType.quickTypeToString r) )

                Err err ->
                    ( (), toJS ("Error: " ++ errorToString err) )


subscriptions : () -> Sub Msg
subscriptions _ =
    fromJS FromJS


main : Program () () Msg
main =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = update
        , subscriptions = subscriptions
        }
